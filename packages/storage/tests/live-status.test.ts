import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { DATABASE_DIRECTORY, LIVE_STATUS_FILE } from "@nana/constants";
import { readAllLiveStatus, readLiveStatus, writeLiveStatus } from "../src/index.ts";
import { createRootDir } from "./setup.ts";

test("写入并读取 SQLite 直播状态", () => {
  const rootDir = createRootDir();
  const startedAt = "2026-08-22T10:00:00.000Z";

  writeLiveStatus(123, { streamer: "Nana", live: true, updatedAt: startedAt }, { rootDir });

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "Nana",
    live: true,
    updatedAt: startedAt,
    title: null,
    area: null,
    viewer: null,
  });
  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, LIVE_STATUS_FILE))).toBe(true);

  const endedAt = "2026-08-22T12:00:00.000Z";
  writeLiveStatus(123, { streamer: "Nana", live: false, updatedAt: endedAt }, { rootDir });

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "Nana",
    live: false,
    updatedAt: endedAt,
    title: null,
    area: null,
    viewer: null,
  });
});

test("写入并读取直播标题、分区与人数", () => {
  const rootDir = createRootDir();
  const updatedAt = "2026-08-22T10:00:00.000Z";

  writeLiveStatus(
    123,
    {
      streamer: "Nana",
      live: true,
      updatedAt,
      title: "今晚直播原神",
      area: "游戏/原神",
      viewer: 1234,
    },
    { rootDir },
  );

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "Nana",
    live: true,
    updatedAt,
    title: "今晚直播原神",
    area: "游戏/原神",
    viewer: 1234,
  });
});

describe("readAllLiveStatus", () => {
  test("读取全部直播状态并按更新时间倒序", () => {
    const rootDir = createRootDir();

    writeLiveStatus(
      4629447,
      { streamer: "饭总", live: true, updatedAt: "2026-08-22T10:00:00.000Z" },
      { rootDir },
    );
    writeLiveStatus(
      10086,
      { streamer: "另一主播", live: false, updatedAt: "2026-08-22T12:00:00.000Z" },
      { rootDir },
    );

    expect(readAllLiveStatus({ rootDir })).toEqual([
      {
        roomId: "10086",
        streamer: "另一主播",
        live: false,
        updatedAt: "2026-08-22T12:00:00.000Z",
        title: null,
        area: null,
        viewer: null,
      },
      {
        roomId: "4629447",
        streamer: "饭总",
        live: true,
        updatedAt: "2026-08-22T10:00:00.000Z",
        title: null,
        area: null,
        viewer: null,
      },
    ]);
  });

  test("空数据库返回空数组", () => {
    const rootDir = createRootDir();
    expect(readAllLiveStatus({ rootDir })).toEqual([]);
  });
});
