import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDanmuMessages, readDanmuSession } from "@nana/storage";
import type { StorageOptions } from "@nana/storage";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import { expect, test } from "vite-plus/test";
import type { WordCloudConfig } from "../src/danmu/config.ts";
import { DanmuRecorder, createDanmuSink } from "../src/danmu/recorder.ts";
import type { AdminSender } from "../src/danmu/types.ts";

/**
 * 录制器用例需要 @nana/wordcloud 的原生依赖（jieba / resvg）与已构建的 workspace 包；
 * 依赖缺失时跳过，避免把环境问题误报成功能回归。
 */

const config: WordCloudConfig = {
  enabled: true,
  topN: 20,
  minWordLength: 2,
  stopWords: [],
  noiseWords: [],
  pollIntervalMs: 0,
};

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-danmu-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

interface SentMessage {
  purpose: unknown;
  text: string;
  imageCount: number;
}

function createRecorder(storage: StorageOptions, sent: SentMessage[]): DanmuRecorder {
  const sendAdminMsg: AdminSender = async (segments, purpose) => {
    sent.push({
      purpose,
      text: segments
        .map((segment) => (segment as { data?: { text?: string } }).data?.text ?? "")
        .join(""),
      imageCount: segments.filter((segment) => (segment as { type?: string }).type === "image")
        .length,
    });
  };

  return new DanmuRecorder({
    roomId: 4629447,
    streamer: "饭总",
    config,
    notifyGroupId: 1101365727,
    sendAdminMsg,
    ...storage,
  });
}

test("开播开始记录、下播停止记录并推送词云", async () => {
  const rootDir = createRootDir();
  const sent: SentMessage[] = [];
  const recorder = createRecorder({ rootDir }, sent);

  recorder.start(new Date("2026-08-22T10:00:00.000Z"));
  recorder.append({ userId: "1", username: "观众甲", content: "今天直播真好看" });
  recorder.append({ userId: "2", username: "观众乙", content: "直播好看，好看得很" });

  expect(recorder.active).toBe(true);

  await recorder.finish("live.ended", new Date("2026-08-22T12:00:00.000Z"));

  expect(recorder.active).toBe(false);
  const session = readDanmuSession(1, { rootDir });
  expect(session?.startedAt).toBe("2026-08-22T10:00:00.000Z");
  expect(session?.endedAt).toBe("2026-08-22T12:00:00.000Z");
  expect(session?.msgCount).toBe(2);
  expect(readDanmuMessages(1, { rootDir }).map((message) => message.content)).toEqual([
    "今天直播真好看",
    "直播好看，好看得很",
  ]);
  expect(sent).toHaveLength(1);
  expect(sent[0].purpose).toMatchObject({ purpose: "wordcloud", subject: "饭总" });
  expect(sent[0].text).toContain("主播: 饭总");
});

test("未开播时收到的弹幕会被忽略，不产生场次", () => {
  const rootDir = createRootDir();
  const recorder = createRecorder({ rootDir }, []);

  recorder.append({ userId: "1", username: "观众甲", content: "路过" });

  expect(recorder.active).toBe(false);
  expect(readDanmuSession(1, { rootDir })).toBeUndefined();
});

test("重复开播不会把一场直播拆成多段", async () => {
  const rootDir = createRootDir();
  const sent: SentMessage[] = [];
  const recorder = createRecorder({ rootDir }, sent);

  recorder.start(new Date("2026-08-22T10:00:00.000Z"));
  recorder.append({ userId: "1", username: "观众甲", content: "第一段" });
  recorder.start(new Date("2026-08-22T10:30:00.000Z"));
  recorder.append({ userId: "1", username: "观众甲", content: "第二段" });

  await recorder.finish("live.ended", new Date("2026-08-22T12:00:00.000Z"));

  expect(readDanmuSession(1, { rootDir })?.msgCount).toBe(2);
  expect(readDanmuSession(2, { rootDir })).toBeUndefined();
});

test("下播事件经由 sink 触发收尾", async () => {
  const rootDir = createRootDir();
  const sent: SentMessage[] = [];
  const recorder = createRecorder({ rootDir }, sent);
  const sink = createDanmuSink(recorder);

  await sink.handle({
    type: "live.started",
    roomId: 4629447,
    streamer: "饭总",
    message: "饭总播了",
    timestamp: new Date("2026-08-22T10:00:00.000Z"),
  });
  await sink.handle({
    type: "danmu.received",
    roomId: 4629447,
    streamer: "饭总",
    content: "今晚吃什么",
    userId: 1,
    username: "观众甲",
    timestamp: new Date("2026-08-22T10:01:00.000Z"),
  });
  await sink.handle({
    type: "live.ended",
    roomId: 4629447,
    streamer: "饭总",
    message: "饭总下播了",
    timestamp: new Date("2026-08-22T11:00:00.000Z"),
  });

  expect(recorder.active).toBe(false);
  expect(readDanmuSession(1, { rootDir })?.msgCount).toBe(1);
  expect(sent).toHaveLength(1);
});
