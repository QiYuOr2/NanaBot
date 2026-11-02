import { expect, test } from "vite-plus/test";
import { appendOfflineAlert, readOfflineAlerts } from "../src/index.ts";
import { createRootDir } from "./setup.ts";

test("离线告警按写入时间从新到旧读取", () => {
  const rootDir = createRootDir();

  appendOfflineAlert(
    {
      kind: "offline",
      offlineSince: "2026-09-07T08:00:00.000Z",
      reason: "heartbeat",
      createdAt: "2026-09-07T08:00:15.000Z",
    },
    { rootDir },
  );
  appendOfflineAlert(
    {
      kind: "recovered",
      offlineSince: "2026-09-07T08:00:00.000Z",
      downtimeMs: 90_000,
      reason: "heartbeat",
      createdAt: "2026-09-07T08:01:45.000Z",
    },
    { rootDir },
  );

  expect(readOfflineAlerts({ rootDir })).toEqual([
    {
      id: 2,
      kind: "recovered",
      offlineSince: "2026-09-07T08:00:00.000Z",
      downtimeMs: 90_000,
      reason: "heartbeat",
      createdAt: "2026-09-07T08:01:45.000Z",
    },
    {
      id: 1,
      kind: "offline",
      offlineSince: "2026-09-07T08:00:00.000Z",
      downtimeMs: null,
      reason: "heartbeat",
      createdAt: "2026-09-07T08:00:15.000Z",
    },
  ]);
});

test("限制返回条数", () => {
  const rootDir = createRootDir();

  appendOfflineAlert(
    {
      kind: "offline",
      offlineSince: "2026-09-07T08:00:00.000Z",
      createdAt: "2026-09-07T08:00:00.000Z",
    },
    { rootDir },
  );
  appendOfflineAlert(
    {
      kind: "recovered",
      offlineSince: "2026-09-07T08:00:00.000Z",
      createdAt: "2026-09-07T08:01:00.000Z",
    },
    { rootDir },
  );

  expect(readOfflineAlerts({ rootDir }, 1).map((alert) => alert.id)).toEqual([2]);
});
