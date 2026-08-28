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
  });
  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, LIVE_STATUS_FILE))).toBe(true);

  const endedAt = "2026-08-22T12:00:00.000Z";
  writeLiveStatus(123, { streamer: "Nana", live: false, updatedAt: endedAt }, { rootDir });

  expect(readLiveStatus(123, { rootDir })).toEqual({
    streamer: "Nana",
    live: false,
    updatedAt: endedAt,
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
      { roomId: "10086", streamer: "另一主播", live: false, updatedAt: "2026-08-22T12:00:00.000Z" },
      { roomId: "4629447", streamer: "饭总", live: true, updatedAt: "2026-08-22T10:00:00.000Z" },
    ]);
  });

  test("空数据库返回空数组", () => {
    const rootDir = createRootDir();
    expect(readAllLiveStatus({ rootDir })).toEqual([]);
  });
});
