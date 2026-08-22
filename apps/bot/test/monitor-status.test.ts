import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readStore } from "@nana/storage";
import { createLiveStatusSink } from "../src/monitor/statusSink.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-status-"));
  writeFileSync(join(rootDir, "nana.config.yaml"), "", "utf8");
  mkdirSync(join(rootDir, "db"));
  return rootDir;
}

test("直播状态变化会写入对应直播间的状态和更新时间", async () => {
  const rootDir = createRootDir();
  const sink = createLiveStatusSink({ rootDir });
  const startedAt = new Date("2026-08-22T10:00:00.000Z");
  const endedAt = new Date("2026-08-22T12:00:00.000Z");

  await sink.handle({
    type: "live.started",
    roomId: 123,
    streamer: "Nana",
    message: "开始直播",
    timestamp: startedAt,
  });
  await sink.handle({
    type: "connection.open",
    roomId: 456,
    streamer: "Other",
  });

  expect(readStore("live-status.yaml", { rootDir })).toEqual({
    "123": { streamer: "Nana", live: true, updatedAt: startedAt.toISOString() },
  });

  await sink.handle({
    type: "live.ended",
    roomId: 123,
    streamer: "Nana",
    message: "下播了",
    timestamp: endedAt,
  });

  expect(readStore("live-status.yaml", { rootDir })).toEqual({
    "123": { streamer: "Nana", live: false, updatedAt: endedAt.toISOString() },
  });
});
