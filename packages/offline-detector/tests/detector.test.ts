import { expect, test } from "vite-plus/test";
import { OfflineDetector, type OfflineState, type OfflineStateStore } from "../src/index.ts";

const T0 = "1970-01-01T00:00:00.000Z";

class MemoryStore implements OfflineStateStore {
  state: OfflineState | undefined;

  read(): OfflineState | undefined {
    return this.state ? { ...this.state } : undefined;
  }

  write(state: OfflineState): void {
    this.state = { ...state };
  }
}

test("连续三次心跳离线才判定掉线，第 3 次才告警", () => {
  const store = new MemoryStore();
  let now = 0;
  const detector = new OfflineDetector({ store, confirmCount: 3, now: () => now });

  expect(detector.reportHeartbeat(false)).toBeUndefined();
  now = 5_000;
  expect(detector.reportHeartbeat(false)).toBeUndefined();
  now = 10_000;
  expect(detector.reportHeartbeat(false)).toEqual({
    kind: "offline",
    offlineSince: T0,
    reason: "heartbeat",
  });
});

test("连续离线未达阈值前出现在线心跳会重置计数", () => {
  const store = new MemoryStore();
  let now = 0;
  const detector = new OfflineDetector({ store, confirmCount: 3, now: () => now });

  detector.reportHeartbeat(false);
  now = 5_000;
  detector.reportHeartbeat(true);
  now = 10_000;
  detector.reportHeartbeat(false);
  now = 15_000;
  detector.reportHeartbeat(false);
  now = 20_000;
  expect(detector.reportHeartbeat(false)).toMatchObject({
    kind: "offline",
    offlineSince: new Date(10_000).toISOString(),
  });
});

test("恢复时计算离线时长并清空离线状态", () => {
  const store = new MemoryStore();
  let now = 0;
  const detector = new OfflineDetector({ store, confirmCount: 3, now: () => now });

  detector.reportHeartbeat(false);
  now = 5_000;
  detector.reportHeartbeat(false);
  now = 10_000;
  detector.reportHeartbeat(false);
  now = 25_000;
  const recovered = detector.reportHeartbeat(true);

  expect(recovered).toEqual({
    kind: "recovered",
    offlineSince: T0,
    downtimeMs: 25_000,
    reason: "heartbeat",
  });
  expect(store.state).toMatchObject({ online: true, offlineCount: 0, offlineSince: null });
});

test("持久化离线状态：重启后不会立刻重复告警，恢复仍能计算时长", () => {
  const store = new MemoryStore();
  store.write({
    online: false,
    offlineCount: 3,
    offlineSince: T0,
    lastOfflineAlertAt: "2026-09-07T08:00:15.000Z",
    lastOnlineAlertAt: null,
  });

  const detector = new OfflineDetector({ store, now: () => 50_000 });
  expect(detector.reportHeartbeat(false)).toBeUndefined();

  const recovered = detector.reportHeartbeat(true);
  expect(recovered).toMatchObject({ kind: "recovered", downtimeMs: 50_000 });
});

test("socket 断开立即视为掉线，已离线时不重复告警", () => {
  const store = new MemoryStore();
  const detector = new OfflineDetector({ store, now: () => 0 });

  expect(detector.reportConnectionLost("socket.close")).toEqual({
    kind: "offline",
    offlineSince: T0,
    reason: "socket.close",
  });
  expect(detector.reportConnectionLost("socket.close")).toBeUndefined();
});

test("恢复后再次掉线仍会告警，不被上次离线告警时间抑制", () => {
  const store = new MemoryStore();
  let now = 0;
  const detector = new OfflineDetector({ store, confirmCount: 3, now: () => now });

  // 第一次离线（模拟 socket.close）
  expect(detector.reportConnectionLost("socket.close")).toMatchObject({ kind: "offline" });
  // 恢复（模拟 socket.open）
  now = 5_000;
  expect(detector.reportConnectionRestored("socket.open")).toMatchObject({ kind: "recovered" });
  // 短时间后再次离线（模拟退出 QQ）：即便距上次离线告警很近，也应正常告警
  now = 10_000;
  detector.reportHeartbeat(false);
  now = 15_000;
  detector.reportHeartbeat(false);
  now = 20_000;
  expect(detector.reportHeartbeat(false)).toMatchObject({ kind: "offline" });
});

test("confirmCount 可配置为 2", () => {
  const store = new MemoryStore();
  let now = 0;
  const detector = new OfflineDetector({ store, confirmCount: 2, now: () => now });

  expect(detector.reportHeartbeat(false)).toBeUndefined();
  now = 5_000;
  expect(detector.reportHeartbeat(false)).toMatchObject({ kind: "offline" });
});
