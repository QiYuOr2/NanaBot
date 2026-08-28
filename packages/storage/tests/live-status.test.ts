import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { DATABASE_DIRECTORY, LIVE_STATUS_FILE } from "@nana/constants";
import { readLiveStatus, writeLiveStatus } from "../src/index.ts";
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
