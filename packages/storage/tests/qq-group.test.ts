import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  prepareQQGroupDiscovery,
  recordDiscoveredQQGroup,
  readDiscoveredQQGroups,
} from "../src/index.ts";

test("发现群按账号隔离、重复事件更新，机器人换绑后清理旧候选", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-qq-discovery-"));
  const storage = { rootDir };
  try {
    const initial = {
      accountId: "main",
      appId: "app1",
      openid: "GROUP",
      lastSeenAt: "2026-11-12T01:00:00Z",
    };
    recordDiscoveredQQGroup(initial, storage);
    recordDiscoveredQQGroup({ ...initial, lastSeenAt: "2026-11-12T02:00:00Z" }, storage);
    recordDiscoveredQQGroup({ ...initial, accountId: "second", appId: "app2" }, storage);
    expect(readDiscoveredQQGroups("main", storage)).toEqual([
      { ...initial, lastSeenAt: "2026-11-12T02:00:00Z" },
    ]);
    prepareQQGroupDiscovery("main", "app3", storage);
    expect(readDiscoveredQQGroups("main", storage)).toEqual([]);
    expect(readDiscoveredQQGroups("second", storage)).toHaveLength(1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
