import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import {
  appendDanmuMessages,
  closeDanmuSession,
  listUnpushedLiveSummaries,
  openDanmuSession,
  readLiveSummary,
} from "@nana/storage";
import { expect, test } from "vite-plus/test";
import { publishLiveSummary, pushUnsentLiveSummaries } from "../src/summary/index.ts";
import type { WordCloudSender } from "../src/danmu/types.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-summary-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

function jsonResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("机器人新生成的摘要发到开播通知群，页面已有的摘要不发", async () => {
  const rootDir = createRootDir();
  const sent: { groupId: number; purpose: string; text: string }[] = [];
  const send: WordCloudSender = async (groupId, segments, purpose) => {
    sent.push({
      groupId,
      purpose: purpose?.purpose ?? "",
      text: segments
        .map((segment) => (segment as { data?: { text?: string } }).data?.text ?? "")
        .join(""),
    });
  };

  const botSession = openDanmuSession(
    { roomId: 4629447, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
    { rootDir },
  );
  appendDanmuMessages(
    botSession.id,
    [
      {
        sentAt: "2026-10-01T10:01:00.000Z",
        userId: "1",
        username: "观众",
        content: "今天在聊新歌",
      },
    ],
    { rootDir },
  );
  closeDanmuSession(
    botSession.id,
    { endedAt: "2026-10-01T12:00:00.000Z", reason: "live.ended" },
    { rootDir },
  );

  const siteSession = openDanmuSession(
    { roomId: 4629447, streamer: "饭总", startedAt: "2026-10-02T10:00:00.000Z" },
    { rootDir },
  );
  appendDanmuMessages(
    siteSession.id,
    [{ sentAt: "2026-10-02T10:01:00.000Z", userId: "1", username: "观众", content: "昨天的场" }],
    { rootDir },
  );
  closeDanmuSession(
    siteSession.id,
    { endedAt: "2026-10-02T12:00:00.000Z", reason: "live.ended" },
    { rootDir },
  );

  const { settleLiveSummary } = await import("@nana/live-summary");
  await settleLiveSummary({
    sessionId: siteSession.id,
    source: "site",
    apiKey: "test-key",
    rootDir,
    fetch: async () => jsonResponse("观众在聊昨天的场，话题集中在回看。"),
  });

  await publishLiveSummary({
    sessionId: siteSession.id,
    streamer: "饭总",
    notifyGroupIds: [1101365727],
    send,
    rootDir,
    apiKey: "test-key",
    fetch: async () => {
      throw new Error("已有摘要时不应再请求模型");
    },
  });
  await publishLiveSummary({
    sessionId: botSession.id,
    streamer: "饭总",
    notifyGroupIds: [1101365727, 511731882],
    send,
    rootDir,
    apiKey: "test-key",
    fetch: async () => jsonResponse("观众在聊今天的新歌，讨论集中在旋律。"),
  });

  expect(sent).toHaveLength(2);
  expect(sent[0]?.groupId).toBe(1101365727);
  expect(sent[1]?.groupId).toBe(511731882);
  expect(sent[0]?.purpose).toBe("live.summary");
  expect(sent[0]?.text).toBe(
    "【直播摘要】根据弹幕推断，不是直播内容本身\n观众在聊今天的新歌，讨论集中在旋律。",
  );
  expect(readLiveSummary(botSession.id, { rootDir })?.pushed).toBe(true);
  expect(readLiveSummary(siteSession.id, { rootDir })).toMatchObject({
    source: "site",
    pushed: false,
  });
  expect(listUnpushedLiveSummaries({ rootDir })).toEqual([]);
});

test("启动时只补发机器人写好但还没发出去的摘要", async () => {
  const rootDir = createRootDir();
  const sent: number[] = [];
  const send: WordCloudSender = async (groupId) => {
    sent.push(groupId);
  };
  const session = openDanmuSession(
    { roomId: 4629447, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
    { rootDir },
  );
  appendDanmuMessages(
    session.id,
    [{ sentAt: "2026-10-01T10:01:00.000Z", userId: "1", username: "观众", content: "还没发出去" }],
    { rootDir },
  );
  closeDanmuSession(
    session.id,
    { endedAt: "2026-10-01T12:00:00.000Z", reason: "live.ended" },
    { rootDir },
  );

  const { settleLiveSummary } = await import("@nana/live-summary");
  const settled = await settleLiveSummary({
    sessionId: session.id,
    source: "bot",
    apiKey: "test-key",
    rootDir,
    fetch: async () => jsonResponse("观众在等补发，话题还是刚才那句。"),
  });
  expect(settled).toMatchObject({ kind: "ready", shouldPush: true });
  expect(listUnpushedLiveSummaries({ rootDir })).toHaveLength(1);

  await pushUnsentLiveSummaries({
    streamers: [
      {
        roomId: 4629447,
        streamer: "饭总",
        notifyEnabled: true,
        notifyGroups: [1101365727],
      },
    ],
    send,
    rootDir,
  });

  expect(sent).toEqual([1101365727]);
  expect(listUnpushedLiveSummaries({ rootDir })).toEqual([]);
});

test("按 roomIds 分批补发时不会误处理其它账号的摘要", async () => {
  const rootDir = createRootDir();
  const sent: number[] = [];
  const send: WordCloudSender = async (groupId) => {
    sent.push(groupId);
  };
  const session = openDanmuSession(
    { roomId: 4629447, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
    { rootDir },
  );
  appendDanmuMessages(
    session.id,
    [{ sentAt: "2026-10-01T10:01:00.000Z", userId: "1", username: "观众", content: "等一下" }],
    { rootDir },
  );
  closeDanmuSession(
    session.id,
    { endedAt: "2026-10-01T12:00:00.000Z", reason: "live.ended" },
    { rootDir },
  );

  const { settleLiveSummary } = await import("@nana/live-summary");
  await settleLiveSummary({
    sessionId: session.id,
    source: "bot",
    apiKey: "test-key",
    rootDir,
    fetch: async () => jsonResponse("观众在等补发。"),
  });

  await pushUnsentLiveSummaries({
    streamers: [
      {
        roomId: 999,
        streamer: "另一个主播",
        notifyEnabled: true,
        notifyGroups: [999],
      },
    ],
    send,
    rootDir,
    roomIds: new Set([999]),
  });

  expect(sent).toEqual([]);
  expect(listUnpushedLiveSummaries({ rootDir })).toHaveLength(1);
});
