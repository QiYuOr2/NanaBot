import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import { expect, test, vi } from "vite-plus/test";
import type { FeatureContext } from "../src/core/feature.ts";
import type { MonitorStreamerConfig } from "../src/monitor/config.ts";
import type { WordCloudConfig } from "../src/danmu/config.ts";

/**
 * 验证「一个主播只有一条 blive 长连接」：开播通知与弹幕录制共用同一条连接的事件流。
 *
 * `@nana/monitor` 本体是真实实现，只替换 `createBliveMonitorSource` 以统计建连次数，
 * 其余（createMonitor 的 sink 分发逻辑）保持真实。
 */
const listenCounts: number[] = [];

vi.mock("@nana/monitor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nana/monitor")>();
  return {
    ...actual,
    createBliveMonitorSource: () => {
      const real = actual.createBliveMonitorSource();
      return {
        listen(roomId: number, handlers: Parameters<typeof real.listen>[1]) {
          listenCounts.push(roomId);
          return real.listen(roomId, handlers);
        },
      };
    },
  };
});

const { createMonitorFeature } = await import("../src/monitor/feature.ts");
const { createWordCloudMonitorSink } = await import("../src/danmu/index.ts");

/** 录制器表的元素类型，从 sink 工厂签名反推，避免直接引用类做类型。 */
type RecorderMap = Parameters<typeof createWordCloudMonitorSink>[1];

const config: WordCloudConfig = {
  enabled: true,
  topN: 30,
  minWordLength: 2,
  stopWords: [],
  noiseWords: [],
  pollIntervalMs: 0,
};

function toStreamer(roomId: number, streamer: string, uid: number): MonitorStreamerConfig {
  return {
    uid,
    roomId,
    streamer,
    notifyEnabled: true,
    notifyGroups: [],
    messages: { liveStart: "", liveEnd: "" },
  };
}

/** 把主播配置转成 `feature.setup` 需要的选项。 */
function toFeatureOptions(streamer: MonitorStreamerConfig) {
  return {
    roomId: streamer.roomId,
    streamer: streamer.streamer,
    uid: streamer.uid,
    notifyEnabled: streamer.notifyEnabled,
    notifyGroupIds: streamer.notifyGroups,
    messages: streamer.messages,
  };
}

const streamers: MonitorStreamerConfig[] = [toStreamer(4629447, "饭总", 145149047)];

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-single-conn-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

function createContext(): FeatureContext {
  return {
    ws: {} as never,
    adminGroupId: undefined,
    on: () => () => {},
    onCleanup: () => {},
    sendAdminText: async () => {},
    sendAdminMsg: async () => {},
    sendGroupMsg: async () => "",
  };
}

test("弹幕录制与开播监控共用同一条长连接", async () => {
  listenCounts.length = 0;
  const rootDir = createRootDir();
  const recorders: RecorderMap = new Map();

  const sinkFactory = createWordCloudMonitorSink(
    { streamers, config, notifyGroupId: 123, sendAdminMsg: async () => {}, rootDir },
    recorders,
  );
  const feature = createMonitorFeature({ createSink: (streamer) => sinkFactory(streamer) });

  const [streamer] = streamers;
  const cleanup = await feature.setup(createContext(), toFeatureOptions(streamer));

  // 单主播只有一条连接（弹幕 + 开播共用），录制器挂在这条连接上。
  expect(listenCounts).toEqual([streamer.roomId]);
  expect(recorders.size).toBe(1);

  if (typeof cleanup === "function") {
    await cleanup();
  }
});

test("未开启词云时不注册 sink，但仍只有一条连接", async () => {
  listenCounts.length = 0;
  const feature = createMonitorFeature();
  const [streamer] = streamers;

  const cleanup = await feature.setup(createContext(), toFeatureOptions(streamer));

  expect(listenCounts).toEqual([streamer.roomId]);

  if (typeof cleanup === "function") {
    await cleanup();
  }
});

test("多个主播各一条连接，不会每人两条", async () => {
  listenCounts.length = 0;
  const rootDir = createRootDir();
  const recorders: RecorderMap = new Map();
  const multiStreamers = [streamers[0], toStreamer(999, "另一位", 2)];

  const sinkFactory = createWordCloudMonitorSink(
    {
      streamers: multiStreamers,
      config,
      notifyGroupId: 123,
      sendAdminMsg: async () => {},
      rootDir,
    },
    recorders,
  );
  const feature = createMonitorFeature({ createSink: (streamer) => sinkFactory(streamer) });

  const cleanups = [];
  for (const item of multiStreamers) {
    cleanups.push(await feature.setup(createContext(), toFeatureOptions(item)));
  }

  // 两个主播 → 两条连接（各自一条），而不是每人两条。
  expect(listenCounts).toEqual([4629447, 999]);
  expect(recorders.size).toBe(2);

  for (const cleanup of cleanups) {
    if (typeof cleanup === "function") {
      await cleanup();
    }
  }
});
