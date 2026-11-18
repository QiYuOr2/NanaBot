import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import type { BilibiliDynamic } from "@nana/bilibili-api";
import { listPendingDynamics, readDynamicItem, readDynamicMonitorState } from "@nana/storage";
import {
  flushPendingDynamics,
  pollStreamerOnce,
  type DynamicFetcher,
  type DynamicLogger,
  type MonitoredStreamer,
} from "../src/dynamic/index.ts";

let rootDir: string;
const logger: DynamicLogger = { info() {}, warn() {}, error() {} };

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "nana-dmon-"));
});
afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function makeDynamic(id: string, overrides: Partial<BilibiliDynamic> = {}): BilibiliDynamic {
  return {
    id,
    uid: 10001,
    authorName: "测试UP",
    authorFace: null,
    type: "video",
    publishedAt: "2026-01-01T00:00:00.000Z",
    text: "",
    title: `视频-${id}`,
    url: `https://t.bilibili.com/${id}`,
    coverUrl: null,
    imageUrls: [],
    ...overrides,
  };
}

/** 可控 fetcher：每次返回预设的动态列表，可抛错。 */
function fakeFetcher(responses: (BilibiliDynamic[] | Error)[]): DynamicFetcher & { calls: number } {
  const state = {
    calls: 0,
    async fetchUserDynamics() {
      const response = responses[Math.min(state.calls, responses.length - 1)];
      state.calls += 1;
      if (response instanceof Error) throw response;
      return response;
    },
  };
  return state;
}

const streamer: MonitoredStreamer = {
  uid: 10001,
  streamer: "测试UP",
  notifyGroups: [123456],
  enableNotify: true,
  types: ["video", "opus", "draw"],
};

test("首次同步只 bootstrap，不推送历史动态", async () => {
  const fetcher = fakeFetcher([[makeDynamic("a"), makeDynamic("b", { type: "opus" })]]);
  const result = await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  expect(result.kind).toBe("bootstrap");
  expect(result.enqueued).toBe(0);
  expect(listPendingDynamics({ rootDir })).toHaveLength(0);
  expect(readDynamicMonitorState(10001, { rootDir })?.initialized).toBe(true);
  expect(readDynamicItem("a", { rootDir })?.pushStatus).toBe("bootstrap");
});

test("首次同步失败不标记初始化完成", async () => {
  const fetcher = fakeFetcher([new Error("网络错误")]);
  await expect(
    pollStreamerOnce({ streamer, fetcher, storage: { rootDir }, logger, now: () => new Date() }),
  ).rejects.toThrow("网络错误");
  expect(readDynamicMonitorState(10001, { rootDir })).toBeUndefined();
});

test("增量轮询去重：同一动态 ID 只入队一次", async () => {
  const fetcher = fakeFetcher([
    [makeDynamic("a")], // bootstrap
    [makeDynamic("c"), makeDynamic("b")], // 新增 b、c
    [makeDynamic("c"), makeDynamic("b")], // 重复
  ]);
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  const second = await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  expect(second.enqueued).toBe(2);
  expect(listPendingDynamics({ rootDir })).toHaveLength(2);

  const third = await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  expect(third.enqueued).toBe(0);
  expect(listPendingDynamics({ rootDir })).toHaveLength(2);
});

test("请求失败不推进游标、不写新记录", async () => {
  // bootstrap 成功
  const fetcher = fakeFetcher([[makeDynamic("a")], new Error("风控")]);
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  const before = readDynamicMonitorState(10001, { rootDir });
  await expect(
    pollStreamerOnce({ streamer, fetcher, storage: { rootDir }, logger, now: () => new Date() }),
  ).rejects.toThrow("风控");
  const after = readDynamicMonitorState(10001, { rootDir });
  expect(after?.lastDynamicId).toBe(before?.lastDynamicId);
});

test("未订阅类型的新动态记为 skipped 不入队", async () => {
  const fetcher = fakeFetcher([
    [makeDynamic("a")],
    [makeDynamic("fwd", { type: "forward" }), makeDynamic("v", { type: "video" })],
  ]);
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  const result = await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  expect(result.enqueued).toBe(1); // 只有 video 入队
  const pending = listPendingDynamics({ rootDir });
  expect(pending.map((item) => item.dynamicId)).toEqual(["v"]);
  expect(readDynamicItem("fwd", { rootDir })?.pushStatus).toBe("skipped");
});

test("flush 成功推送后标记 success 并写出", async () => {
  const fetcher = fakeFetcher([[makeDynamic("a")], [makeDynamic("b")]]);
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });

  const sent: string[] = [];
  const result = await flushPendingDynamics({
    storage: { rootDir },
    logger,
    now: () => new Date("2026-01-01T00:01:00.000Z"),
    routeFor: () => ({ notifyGroups: [123456], enableNotify: true }),
    pusher: async (formatted) => {
      sent.push(formatted.subject);
      return { delivered: true, errors: [] };
    },
  });
  expect(result.success).toBe(1);
  expect(sent).toEqual(["测试UP"]);
  expect(readDynamicItem("b", { rootDir })?.pushStatus).toBe("success");
});

test("flush 失败保留 pending 供下次重试", async () => {
  const fetcher = fakeFetcher([[makeDynamic("a")], [makeDynamic("b")]]);
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });

  const result = await flushPendingDynamics({
    storage: { rootDir },
    logger,
    now: () => new Date(),
    routeFor: () => ({ notifyGroups: [123456], enableNotify: true }),
    pusher: async () => {
      throw new Error("发送失败");
    },
  });
  expect(result.failed).toBe(1);
  expect(listPendingDynamics({ rootDir })).toHaveLength(1);
});

test("flush 对无通知群的 UID 跳过，不推送", async () => {
  const fetcher = fakeFetcher([[makeDynamic("a")], [makeDynamic("b")]]);
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });

  let called = false;
  const result = await flushPendingDynamics({
    storage: { rootDir },
    logger,
    now: () => new Date(),
    routeFor: () => undefined,
    pusher: async () => {
      called = true;
      return { delivered: true, errors: [] };
    },
  });
  expect(called).toBe(false);
  expect(result.skipped).toBe(1);
});

test("重启恢复：遗留 pending 可被再次发送", async () => {
  const fetcher = fakeFetcher([[makeDynamic("a")], [makeDynamic("b")]]);
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  await pollStreamerOnce({
    streamer,
    fetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  expect(listPendingDynamics({ rootDir })).toHaveLength(1);

  // 模拟重启后再次 flush（无 in-memory 状态，全部从库读）
  const result = await flushPendingDynamics({
    storage: { rootDir },
    logger,
    now: () => new Date(),
    routeFor: () => ({ notifyGroups: [123456], enableNotify: true }),
    pusher: async () => ({ delivered: true, errors: [] }),
  });
  expect(result.success).toBe(1);
  expect(listPendingDynamics({ rootDir })).toHaveLength(0);
});

test("多 UID 游标隔离：一个 UID 失败不影响另一个", async () => {
  const streamerB: MonitoredStreamer = { ...streamer, uid: 20002, streamer: "另一个UP" };
  const goodFetcher = fakeFetcher([
    [makeDynamic("x", { uid: 10001 })],
    [makeDynamic("y", { uid: 10001 })],
  ]);
  const badFetcher = fakeFetcher([new Error("坏了")]);

  await pollStreamerOnce({
    streamer,
    fetcher: goodFetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  });
  await pollStreamerOnce({
    streamer: streamerB,
    fetcher: badFetcher,
    storage: { rootDir },
    logger,
    now: () => new Date(),
  }).catch(() => {});

  expect(readDynamicMonitorState(10001, { rootDir })?.initialized).toBe(true);
  expect(readDynamicMonitorState(20002, { rootDir })).toBeUndefined();
});
