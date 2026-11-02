import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import { closeDanmuSession, openDanmuSession, readLiveSummary } from "@nana/storage";
import { appendDanmuMessages } from "@nana/storage";
import { describe, expect, test } from "vite-plus/test";
import {
  buildDanmuExcerpt,
  normalizeSummaryText,
  renderLiveSummaryMessage,
  settleLiveSummary,
} from "../src/index.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-live-summary-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

describe("弹幕摘录与正文", () => {
  test("空白弹幕不会进入摘录", () => {
    expect(buildDanmuExcerpt([{ content: "  " }, { content: "" }])).toEqual({
      text: "",
      usableCount: 0,
    });
  });

  test("重复句和靠近结尾的发言会留下，超长正文截在句号", () => {
    const messages = [
      ...Array.from({ length: 5 }, () => ({ content: "好听" })),
      { content: `${"很".repeat(180)}。后面这句不该留下` },
    ];
    const excerpt = buildDanmuExcerpt(messages);
    expect(excerpt.usableCount).toBe(6);
    expect(excerpt.text).toContain("好听 ×5");

    const normalized = normalizeSummaryText(`摘要：${"很".repeat(80)}。${"后".repeat(160)}`);
    expect(Array.from(normalized).length).toBeLessThanOrEqual(200);
    expect(normalized.endsWith("。")).toBe(true);
    expect(normalized).not.toContain("不该留下");
    expect(renderLiveSummaryMessage("观众在聊歌")).toBe(
      "【直播摘要】根据弹幕推断，不是直播内容本身\n观众在聊歌",
    );
  });
});

describe("settleLiveSummary", () => {
  test("没有弹幕时写成 empty，页面来源不会要求发群", async () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: 1, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    const settled = await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      fetch: async () => {
        throw new Error("没有弹幕时不应该请求模型");
      },
    });

    expect(settled).toMatchObject({
      kind: "ready",
      status: "empty",
      shouldPush: false,
      text: null,
    });
    expect(readLiveSummary(session.id, { rootDir })).toMatchObject({
      status: "empty",
      source: "site",
    });
  });

  test("机器人生成成功后才标记应发群，再次调用直接复用正文", async () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: 1, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    appendDanmuMessages(
      session.id,
      [
        {
          sentAt: "2026-10-01T10:01:00.000Z",
          userId: "1",
          username: "观众",
          content: "这首歌好好听",
        },
      ],
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "观众一直在说这首歌很好听，讨论集中在旋律和现场。" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const first = await settleLiveSummary({
      sessionId: session.id,
      source: "bot",
      apiKey: "test-key",
      rootDir,
      fetch: fetchImpl,
    });
    const second = await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      fetch: fetchImpl,
    });

    expect(calls).toBe(1);
    expect(first).toMatchObject({
      kind: "ready",
      status: "ok",
      shouldPush: true,
      text: "观众一直在说这首歌很好听，讨论集中在旋律和现场。",
    });
    expect(second).toMatchObject({
      kind: "ready",
      status: "ok",
      shouldPush: false,
      text: first.kind === "ready" ? first.text : "",
    });
  });

  test("页面生成成功也不要求发群", async () => {
    const rootDir = createRootDir();
    const session = openDanmuSession(
      { roomId: 1, streamer: "饭总", startedAt: "2026-10-01T10:00:00.000Z" },
      { rootDir },
    );
    appendDanmuMessages(
      session.id,
      [
        {
          sentAt: "2026-10-01T10:01:00.000Z",
          userId: "1",
          username: "观众",
          content: "在看老视频",
        },
      ],
      { rootDir },
    );
    closeDanmuSession(
      session.id,
      { endedAt: "2026-10-01T11:00:00.000Z", reason: "live.ended" },
      { rootDir },
    );

    const settled = await settleLiveSummary({
      sessionId: session.id,
      source: "site",
      apiKey: "test-key",
      rootDir,
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "观众在看老视频，话题集中在以前的片段。" } }],
          }),
          {
            status: 200,
          },
        ),
    });

    expect(settled).toMatchObject({ kind: "ready", status: "ok", shouldPush: false });
    expect(readLiveSummary(session.id, { rootDir })?.source).toBe("site");
  });
});
