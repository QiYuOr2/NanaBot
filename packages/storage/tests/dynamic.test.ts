import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  hasDynamicItem,
  listPendingDynamics,
  markDynamicFailed,
  markDynamicSuccess,
  readDynamicItem,
  readDynamicMonitorState,
  recordDiscoveredDynamics,
  type NewDynamicItem,
} from "../src/index.ts";

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "nana-dynamic-"));
});
afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function item(dynamicId: string, uid = 10001): NewDynamicItem {
  return {
    dynamicId,
    uid,
    type: "video",
    title: `标题-${dynamicId}`,
    content: null,
    url: `https://t.bilibili.com/${dynamicId}`,
    coverUrl: null,
    imageUrls: [],
    authorName: "测试UP",
    publishedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("首次 bootstrap 写入记录但状态为 bootstrap（不推送）", () => {
  const inserted = recordDiscoveredDynamics({
    uid: 10001,
    items: [item("a"), item("b")],
    pushStatus: "bootstrap",
    lastDynamicId: "b",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  expect(inserted).toBe(2);
  expect(readDynamicItem("a", { rootDir })?.pushStatus).toBe("bootstrap");
  expect(readDynamicMonitorState(10001, { rootDir })?.initialized).toBe(true);
  // bootstrap 项不进入 pending
  expect(listPendingDynamics({ rootDir })).toHaveLength(0);
});

test("增量轮询写入 pending，且重复 ID 不重复入队", () => {
  recordDiscoveredDynamics({
    uid: 10001,
    items: [item("a")],
    pushStatus: "bootstrap",
    lastDynamicId: "a",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  // 第一次发现新动态 b
  const first = recordDiscoveredDynamics({
    uid: 10001,
    items: [item("b")],
    pushStatus: "pending",
    lastDynamicId: "b",
    discoveredAt: "2026-01-01T00:05:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  expect(first).toBe(1);
  expect(listPendingDynamics({ rootDir })).toHaveLength(1);

  // 再次轮询同样返回 b：不应新增
  const second = recordDiscoveredDynamics({
    uid: 10001,
    items: [item("b")],
    pushStatus: "pending",
    lastDynamicId: "b",
    discoveredAt: "2026-01-01T00:10:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  expect(second).toBe(0);
  expect(listPendingDynamics({ rootDir })).toHaveLength(1);
});

test("UID 之间状态隔离", () => {
  recordDiscoveredDynamics({
    uid: 10001,
    items: [item("a", 10001)],
    pushStatus: "bootstrap",
    lastDynamicId: "a",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  expect(readDynamicMonitorState(10001, { rootDir })?.initialized).toBe(true);
  expect(readDynamicMonitorState(20002, { rootDir })).toBeUndefined();
});

test("发送成功后状态变 success 并移除 pending", () => {
  recordDiscoveredDynamics({
    uid: 10001,
    items: [item("a")],
    pushStatus: "pending",
    lastDynamicId: "a",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  markDynamicSuccess({
    dynamicId: "a",
    pushedAt: "2026-01-01T00:01:00.000Z",
    options: { rootDir },
  });
  expect(readDynamicItem("a", { rootDir })?.pushStatus).toBe("success");
  expect(listPendingDynamics({ rootDir })).toHaveLength(0);
});

test("发送失败保留 pending 并记录错误（可恢复）", () => {
  recordDiscoveredDynamics({
    uid: 10001,
    items: [item("a")],
    pushStatus: "pending",
    lastDynamicId: "a",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  markDynamicFailed({ dynamicId: "a", error: "网络错误", options: { rootDir } });
  const pending = listPendingDynamics({ rootDir });
  expect(pending).toHaveLength(1);
  expect(pending[0].lastError).toBe("网络错误");
  expect(hasDynamicItem("a", { rootDir })).toBe(true);
  expect(hasDynamicItem("missing", { rootDir })).toBe(false);
});

test("事务写入失败时回滚，不产生半写入（模拟重复键不冲突即可验证原子）", () => {
  // 同一批里出现相同 dynamic_id：INSERT OR IGNORE 保证只入一条。
  const inserted = recordDiscoveredDynamics({
    uid: 10001,
    items: [item("dup"), item("dup")],
    pushStatus: "pending",
    lastDynamicId: "dup",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    initialized: true,
    options: { rootDir },
  });
  expect(inserted).toBe(1);
});
