import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLiveStatus } from "@nana/storage";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import type { LiveStatusInfo } from "@nana/bilibili-api";
import { expect, test } from "vite-plus/test";
import type { MonitorStreamerConfig } from "../src/monitor/config.ts";
import { syncLiveStatus } from "../src/monitor/sync.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-sync-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

function createStatusInfo(uid: number, roomId: number, liveStatus: number): LiveStatusInfo {
  return {
    title: "正在直播",
    room_id: roomId,
    uid,
    online: 789,
    live_time: 1_700_000_000,
    live_status: liveStatus as LiveStatusInfo["live_status"],
    short_id: 0,
    area: 1,
    area_name: "示例分区",
    area_v2_id: 2,
    area_v2_name: "示例新版分区",
    area_v2_parent_id: 3,
    area_v2_parent_name: "示例父分区",
    uname: "示例主播",
    face: "https://example.com/face.jpg",
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

test("启动同步会把 B 站直播状态写入数据库", async () => {
  const rootDir = createRootDir();
  const streamers: MonitorStreamerConfig[] = [
    {
      uid: 456,
      roomId: 123,
      streamer: "示例主播",
      notifyEnabled: true,
      notifyGroups: [],
      messages: { liveStart: "", liveEnd: "" },
      wordCloud: { enabled: false, notifyGroups: [] },
    },
  ];

  await syncLiveStatus(streamers, {
    rootDir,
    fetch: createFetchMock({ "456": createStatusInfo(456, 123, 1) }),
  });

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "示例主播",
    live: true,
    updatedAt: expect.any(String),
    title: "正在直播",
    area: "示例新版分区",
    viewer: 789,
  });
});

test("未开播状态（live_status=0）会写入 live=false", async () => {
  const rootDir = createRootDir();
  const streamers: MonitorStreamerConfig[] = [
    {
      uid: 456,
      roomId: 123,
      streamer: "示例主播",
      notifyEnabled: true,
      notifyGroups: [],
      messages: { liveStart: "", liveEnd: "" },
      wordCloud: { enabled: false, notifyGroups: [] },
    },
  ];

  await syncLiveStatus(streamers, {
    rootDir,
    fetch: createFetchMock({ "456": createStatusInfo(456, 123, 0) }),
  });

  expect(readLiveStatus(123, { rootDir })?.live).toBe(false);
});

test("接口未返回的 UID 不会写入数据库", async () => {
  const rootDir = createRootDir();
  const streamers: MonitorStreamerConfig[] = [
    {
      uid: 456,
      roomId: 123,
      streamer: "示例主播",
      notifyEnabled: true,
      notifyGroups: [],
      messages: { liveStart: "", liveEnd: "" },
      wordCloud: { enabled: false, notifyGroups: [] },
    },
  ];

  await syncLiveStatus(streamers, {
    rootDir,
    fetch: createFetchMock({}),
  });

  expect(readLiveStatus(123, { rootDir })).toBeUndefined();
});

test("没有主播时跳过请求", async () => {
  const rootDir = createRootDir();
  await expect(syncLiveStatus([], { rootDir })).resolves.toBeUndefined();
});
