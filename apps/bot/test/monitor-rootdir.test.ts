import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_DIRECTORY, LIVE_STATUS_FILE, NANA_CONFIG_FILE } from "@nana/constants";
import { readLiveStatus } from "@nana/storage";
import { expect, test, vi } from "vite-plus/test";
import type { FeatureContext } from "../src/core/feature.ts";
import { consoleLogger } from "../src/core/logger.ts";
import type { MonitorStreamerConfig } from "../src/monitor/config.ts";

/**
 * 回归保护：直播状态落库必须写在显式传入的 `rootDir` 下，
 * 而不是依赖 `process.cwd()` 去推导——pm2 把 cwd 配成 `apps/bot` 时也必须稳定。
 *
 * 注意：这里**不传 uid**，避免 sink 去请求 B 站接口；同时 `emit` 是异步分发的，
 * 断言前要等一个宏任务，让 sink 的写入完成。
 */
const captured: { handlers?: Record<string, (payload: unknown) => void | Promise<void>> } = {};

vi.mock("@nana/monitor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nana/monitor")>();
  return {
    ...actual,
    createBliveMonitorSource: () => ({
      listen(_roomId: number, next: Record<string, (payload: unknown) => void | Promise<void>>) {
        captured.handlers = next;
        return { close() {} };
      },
    }),
  };
});

const { createMonitorFeature } = await import("../src/monitor/feature.ts");

const streamer: MonitorStreamerConfig = {
  uid: 145149047,
  roomId: 4629447,
  streamer: "饭总",
  notifyEnabled: true,
  notifyGroups: [],
  messages: { liveStart: "", liveEnd: "" },
  wordCloud: { enabled: false, notifyGroups: [] },
};

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-root-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

function createContext(): FeatureContext {
  return {
    ws: {} as never,
    adminGroupId: undefined,
    logger: consoleLogger,
    on: () => () => {},
    onCleanup: () => {},
    sendAdminText: async () => {},
    sendAdminMsg: async () => {},
    sendGroupMsg: async () => "",
  };
}

/** 等 sink 的异步写入完成（`emit` 不 await，只在拒绝时记日志）。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

test("直播状态写入显式 rootDir，而不是当前工作目录", async () => {
  const rootDir = createRootDir();
  const feature = createMonitorFeature({ rootDir });

  const cleanup = await feature.setup(createContext(), {
    // 不传 uid：避免触发 B 站 API 请求，专注验证落库路径。
    roomId: streamer.roomId,
    streamer: streamer.streamer,
    notifyEnabled: streamer.notifyEnabled,
    notifyGroupIds: streamer.notifyGroups,
    messages: streamer.messages,
  });

  await captured.handlers?.onLiveStart({
    timestamp: new Date("2026-08-22T10:00:00Z"),
    hasLiveTime: true,
  });
  await flush();

  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, LIVE_STATUS_FILE))).toBe(true);
  expect(readLiveStatus(streamer.roomId, { rootDir })?.live).toBe(true);

  if (typeof cleanup === "function") {
    await cleanup();
  }
});

test("切换 cwd 后仍然写入同一个 rootDir（模拟 pm2 的 cwd 差异）", async () => {
  const rootDir = createRootDir();
  const otherDir = mkdtempSync(join(tmpdir(), "nana-bot-cwd-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(otherDir);

    const feature = createMonitorFeature({ rootDir });
    const cleanup = await feature.setup(createContext(), {
      roomId: streamer.roomId,
      streamer: streamer.streamer,
      notifyEnabled: streamer.notifyEnabled,
      notifyGroupIds: streamer.notifyGroups,
      messages: streamer.messages,
    });

    await captured.handlers?.onLiveStart({
      timestamp: new Date("2026-08-22T10:00:00Z"),
      hasLiveTime: true,
    });
    await flush();

    // cwd 指向了无关目录，数据依然落在显式 rootDir。
    expect(readLiveStatus(streamer.roomId, { rootDir })?.live).toBe(true);

    if (typeof cleanup === "function") {
      await cleanup();
    }
  } finally {
    process.chdir(originalCwd);
  }
});
