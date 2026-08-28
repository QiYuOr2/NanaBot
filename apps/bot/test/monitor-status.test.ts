import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLiveStatus } from "@nana/storage";
import { DATABASE_DIRECTORY, LIVE_STATUS_FILE, NANA_CONFIG_FILE } from "@nana/constants";
import type { LiveStatusInfo } from "@nana/bilibili-api";
import { expect, test } from "vite-plus/test";
import { createLiveStatusSink } from "../src/monitor/statusSink.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-status-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

function createStatusInfo(uid: number, roomId: number): LiveStatusInfo {
  return {
    title: "正在直播",
    room_id: roomId,
    uid,
    online: 789,
    live_time: 1_700_000_000,
    live_status: 1,
    short_id: 0,
    area: 1,
    area_name: "示例分区",
    area_v2_id: 2,
    area_v2_name: "游戏/示例",
    area_v2_parent_id: 3,
    area_v2_parent_name: "游戏",
    uname: "Nana",
    face: "",
    tag_name: "",
    tags: "",
    cover_from_user: "",
    keyframe: "",
    lock_till: "",
    hidden_till: "",
    broadcast_type: 0,
  };
}

function createFetchMock(data: Record<string, LiveStatusInfo>): typeof globalThis.fetch {
  return async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ code: 0, message: "success", data }), {
      headers: { "content-type": "application/json" },
    });
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

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "Nana",
    live: true,
    updatedAt: startedAt.toISOString(),
    title: null,
    area: null,
    viewer: null,
  });
  expect(readLiveStatus(456, { rootDir })).toBeUndefined();

  await sink.handle({
    type: "live.ended",
    roomId: 123,
    streamer: "Nana",
    message: "下播了",
    timestamp: endedAt,
  });

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "Nana",
    live: false,
    updatedAt: endedAt.toISOString(),
    title: null,
    area: null,
    viewer: null,
  });

  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, LIVE_STATUS_FILE))).toBe(true);
  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, "live-status.yaml"))).toBe(false);
});

test("传入 uid 时，开播会拉取并写入标题、分区与人数", async () => {
  const rootDir = createRootDir();
  const sink = createLiveStatusSink({
    rootDir,
    uid: 456,
    fetch: createFetchMock({ "456": createStatusInfo(456, 123) }),
  });
  const startedAt = new Date("2026-08-22T10:00:00.000Z");

  await sink.handle({
    type: "live.started",
    roomId: 123,
    streamer: "Nana",
    message: "开始直播",
    timestamp: startedAt,
  });

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "Nana",
    live: true,
    updatedAt: startedAt.toISOString(),
    title: "正在直播",
    area: "游戏/示例",
    viewer: 789,
  });
});
