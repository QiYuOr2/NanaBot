import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { APP_STATE_FILE, DATABASE_DIRECTORY } from "@nana/constants";
import { readAppState, writeAppState } from "../src/index.ts";
import { createRootDir } from "./setup.ts";

test("写入并读取应用状态", () => {
  const rootDir = createRootDir();
  const offlineSince = "2026-09-07T08:00:00.000Z";

  writeAppState(
    {
      online: false,
      offlineCount: 3,
      offlineSince,
      lastOfflineAlertAt: "2026-09-07T08:00:15.000Z",
      lastOnlineAlertAt: null,
    },
    { rootDir },
  );

  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, APP_STATE_FILE))).toBe(true);
  expect(readAppState({ rootDir })).toEqual({
    online: false,
    offlineCount: 3,
    offlineSince,
    lastOfflineAlertAt: "2026-09-07T08:00:15.000Z",
    lastOnlineAlertAt: null,
  });
});

test("覆盖写入同一行状态", () => {
  const rootDir = createRootDir();

  writeAppState(
    {
      online: false,
      offlineCount: 3,
      offlineSince: "2026-09-07T08:00:00.000Z",
      lastOfflineAlertAt: null,
      lastOnlineAlertAt: null,
    },
    { rootDir },
  );
  writeAppState(
    {
      online: true,
      offlineCount: 0,
      offlineSince: null,
      lastOfflineAlertAt: null,
      lastOnlineAlertAt: "2026-09-07T08:05:00.000Z",
    },
    { rootDir },
  );

  expect(readAppState({ rootDir })).toEqual({
    online: true,
    offlineCount: 0,
    offlineSince: null,
    lastOfflineAlertAt: null,
    lastOnlineAlertAt: "2026-09-07T08:05:00.000Z",
  });
});

test("空数据库返回 undefined", () => {
  const rootDir = createRootDir();
  expect(readAppState({ rootDir })).toBeUndefined();
});

test("按 accountId 隔离多账号的在线状态", () => {
  const rootDir = createRootDir();

  writeAppState(
    {
      online: false,
      offlineCount: 3,
      offlineSince: "2026-09-07T08:00:00.000Z",
      lastOfflineAlertAt: null,
      lastOnlineAlertAt: null,
    },
    { rootDir, accountId: "second" },
  );

  expect(readAppState({ rootDir })).toBeUndefined();
  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, "app-state-second.sqlite"))).toBe(true);
  expect(readAppState({ rootDir, accountId: "second" })).toMatchObject({
    online: false,
    offlineCount: 3,
  });
});
