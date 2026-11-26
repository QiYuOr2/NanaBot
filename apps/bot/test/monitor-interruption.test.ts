import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import type { MonitorController, MonitorSourceHandlers } from "@nana/monitor";
import {
  readDanmuMessages,
  readDanmuSession,
  readDanmuSessionCutOffs,
  readLatestCutOffByRooms,
  readLiveStatus,
} from "@nana/storage";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { FeatureContext } from "../src/core/feature.ts";
import { consoleLogger } from "../src/core/logger.ts";
import type { WordCloudConfig } from "../src/danmu/config.ts";
import type { MonitorStreamerConfig } from "../src/monitor/config.ts";
import type { MessagePart } from "../src/message/parts.ts";

const captured: { handlers?: MonitorSourceHandlers } = {};

vi.mock("@nana/monitor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nana/monitor")>();
  return {
    ...actual,
    createBliveMonitorSource: () => ({
      listen(_roomId: number, next: MonitorSourceHandlers) {
        captured.handlers = next;
        return { close() {} };
      },
    }),
  };
});

const { createMonitorFeature } = await import("../src/monitor/feature.ts");
const { createWordCloudMonitorSink, wordCloudFeature } = await import("../src/danmu/index.ts");

const T0 = new Date("2026-08-22T10:00:00.000Z");

const baseStreamer: MonitorStreamerConfig = {
  uid: 145149047,
  roomId: 4629447,
  streamer: "饭总",
  notifyEnabled: true,
  notifyGroups: [200001],
  messages: {
    liveStart: "{uname}开播了 https://live.bilibili.com/{roomId} {@all}",
    liveEnd: "饭总下播了",
  },
  gracePeriodMs: 10 * 60 * 1000,
  minNormalLiveMs: 30 * 60 * 1000,
  wordCloud: { enabled: true, notifyGroups: [300001] },
};

const wordCloudConfig: WordCloudConfig = {
  topN: 20,
  minWordLength: 2,
  stopWords: [],
  noiseWords: [],
  pollIntervalMs: 0,
};

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-interrupt-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

interface SentGroup {
  groupId: number;
  purpose: string;
  text: string;
  hasAtAll: boolean;
}

function createContext(sent: SentGroup[]): FeatureContext {
  return {
    accountId: "test",
    adminGroupId: 999999,
    logger: consoleLogger,
    onConnectionState: () => () => {},
    onMessage: () => () => {},
    replyMessage: async () => {},
    sendMessage: async () => {},
    onCleanup: () => {},
    sendAdminText: async () => {},
    sendAdminMsg: async () => {},
    sendGroupMsg: async (groupId, options, segments: MessagePart[]) => {
      const text = segments
        .map((segment) => (segment.type === "text" ? segment.text : ""))
        .join("");
      const hasAtAll = segments.some((segment) => segment.type === "atAll");
      sent.push({ groupId, purpose: options.purpose, text, hasAtAll });
      return "通知群";
    },
  };
}

async function setupEnv(
  options: {
    withWordCloud?: boolean;
    pollIntervalMs?: number;
    isLive?: () => Promise<boolean>;
  } = {},
) {
  const rootDir = createRootDir();
  const sent: SentGroup[] = [];
  const wordClouds: number[] = [];
  const summaries: { sessionId: number; closeReason: string }[] = [];
  const recorders = new Map<number, never>();
  const monitors = new Map<number, MonitorController>();

  const wcConfig: WordCloudConfig = {
    ...wordCloudConfig,
    pollIntervalMs: options.pollIntervalMs ?? 0,
  };

  const wcOptions = {
    streamers: [baseStreamer],
    config: wcConfig,
    rootDir,
    recorders,
    isLive: options.isLive,
    onPollOffline: (roomId: number) => monitors.get(roomId)?.handlePollOffline() ?? false,
    sendWordCloud: async (groupId: number) => {
      wordClouds.push(groupId);
    },
    onSessionClosed: async (input: { sessionId: number; closeReason: string }) => {
      summaries.push({ sessionId: input.sessionId, closeReason: input.closeReason });
    },
  };

  const sinkFactory =
    options.withWordCloud !== false
      ? createWordCloudMonitorSink(wcOptions as never, recorders as never)
      : undefined;

  const context = createContext(sent);
  const monitorFeature = createMonitorFeature({
    rootDir,
    monitors,
    checkLiveStatus: options.isLive ?? (async () => false),
    createSink: sinkFactory ? (item) => sinkFactory(item) : undefined,
  });

  const stopMonitor = await monitorFeature.setup(context, {
    roomId: baseStreamer.roomId,
    streamer: baseStreamer.streamer,
    // 不传 uid 以避免测试访问真实 B 站 HTTP 接口
    notifyEnabled: baseStreamer.notifyEnabled,
    notifyGroupIds: baseStreamer.notifyGroups,
    messages: baseStreamer.messages,
    gracePeriodMs: baseStreamer.gracePeriodMs,
    minNormalLiveMs: baseStreamer.minNormalLiveMs,
  });

  const stopWordCloud =
    options.withWordCloud !== false
      ? await wordCloudFeature.setup(context, wcOptions as never)
      : undefined;

  return {
    rootDir,
    sent,
    wordClouds,
    summaries,
    monitors,
    async cleanup() {
      if (typeof stopWordCloud === "function") await stopWordCloud();
      if (typeof stopMonitor === "function") await stopMonitor();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test("超管切断：发普通消息、落库记录，宽限期未重开则以 cut_off 收尾并推送词云与直播总结", async () => {
  vi.useFakeTimers();
  const env = await setupEnv();

  await captured.handlers?.onLiveStart({ timestamp: T0, hasLiveTime: true });
  await captured.handlers?.onIncomeDanmu({
    timestamp: new Date(T0.getTime() + 60_000),
    content: "测试弹幕",
    userId: 1,
    username: "观众甲",
  });

  const cutAt = new Date(T0.getTime() + 45 * 60 * 1000);
  await captured.handlers?.onRoomCutOff({ timestamp: cutAt, reason: "画面涉嫌违规" });
  await captured.handlers?.onLiveEnd({ timestamp: new Date(cutAt.getTime() + 1_000) });

  // 开播（带 @all） + 超管切断（普通消息，无 @all）
  expect(env.sent).toEqual([
    {
      groupId: 200001,
      purpose: "live.start",
      text: "饭总开播了 https://live.bilibili.com/4629447 ",
      hasAtAll: true,
    },
    {
      groupId: 200001,
      purpose: "live.cutoff",
      text: "饭总 直播间被超管切断（原因：画面涉嫌违规）",
      hasAtAll: false,
    },
  ]);

  // 宽限期内不发词云和总结，但超管切断已落库、直播状态已更新
  expect(env.wordClouds).toEqual([]);
  expect(env.summaries).toEqual([]);
  expect(readLiveStatus(4629447, { rootDir: env.rootDir })?.live).toBe(false);
  expect(readDanmuSessionCutOffs(1, { rootDir: env.rootDir })).toHaveLength(1);
  expect(readDanmuSessionCutOffs(1, { rootDir: env.rootDir })[0]?.reason).toBe("画面涉嫌违规");

  // 宽限期到期仍未开播：以 cut_off 收尾并推送词云与直播总结
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(readDanmuSession(1, { rootDir: env.rootDir })).toMatchObject({
    endedAt: cutAt.toISOString(),
    closeReason: "cut_off",
  });
  expect(env.wordClouds).toEqual([300001]);
  expect(env.summaries).toEqual([{ sessionId: 1, closeReason: "cut_off" }]);

  await env.cleanup();
});

test("超管切断后宽限期内重开：发无 @all 恢复消息、延续原场次，切断记录保留在场次上", async () => {
  vi.useFakeTimers();
  const env = await setupEnv();

  await captured.handlers?.onLiveStart({ timestamp: T0, hasLiveTime: true });
  await captured.handlers?.onIncomeDanmu({
    timestamp: new Date(T0.getTime() + 60_000),
    content: "切断前弹幕",
    userId: 1,
    username: "观众甲",
  });

  const cutAt = new Date(T0.getTime() + 45 * 60 * 1000);
  await captured.handlers?.onRoomCutOff({ timestamp: cutAt, reason: "版权画面" });
  await captured.handlers?.onLiveEnd({ timestamp: new Date(cutAt.getTime() + 1_000) });

  const resumeAt = new Date(cutAt.getTime() + 3 * 60 * 1000);
  await captured.handlers?.onLiveStart({ timestamp: resumeAt, hasLiveTime: true });
  await captured.handlers?.onIncomeDanmu({
    timestamp: new Date(resumeAt.getTime() + 30_000),
    content: "恢复后弹幕",
    userId: 2,
    username: "观众乙",
  });

  expect(env.sent).toHaveLength(3);
  expect(env.sent[2]).toEqual({
    groupId: 200001,
    purpose: "live.resume",
    text: "饭总开播了 https://live.bilibili.com/4629447",
    hasAtAll: false,
  });
  expect(env.wordClouds).toEqual([]);
  expect(env.summaries).toEqual([]);
  expect(readLiveStatus(4629447, { rootDir: env.rootDir })?.live).toBe(true);

  // 正常下播：两段弹幕仍在同一场次，且保留切断记录
  const normalEndAt = new Date(T0.getTime() + 90 * 60 * 1000);
  await captured.handlers?.onLiveEnd({ timestamp: normalEndAt });
  await vi.advanceTimersByTimeAsync(10);

  expect(readDanmuSession(1, { rootDir: env.rootDir })).toMatchObject({
    endedAt: normalEndAt.toISOString(),
    closeReason: "live.ended",
    msgCount: 2,
  });
  expect(readDanmuSession(2, { rootDir: env.rootDir })).toBeUndefined();
  expect(readDanmuMessages(1, { rootDir: env.rootDir }).map((m) => m.content)).toEqual([
    "切断前弹幕",
    "恢复后弹幕",
  ]);
  expect(readDanmuSessionCutOffs(1, { rootDir: env.rootDir })).toHaveLength(1);
  expect(env.wordClouds).toEqual([300001]);
  expect(env.summaries).toEqual([{ sessionId: 1, closeReason: "live.ended" }]);

  await env.cleanup();
});

test("直播不足 30 分钟中断进入宽限期：不触发下播总结，轮询兜底不提前掐断，重开不带 @all", async () => {
  vi.useFakeTimers();
  const env = await setupEnv({
    pollIntervalMs: 2 * 60 * 1000,
    isLive: async () => false,
  });

  await captured.handlers?.onLiveStart({ timestamp: T0, hasLiveTime: true });
  await captured.handlers?.onLiveEnd({ timestamp: new Date(T0.getTime() + 12 * 60 * 1000) });

  // 经过两次 2 分钟轮询兜底，因为仍在宽限期内，不应提前结束场次
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
  expect(env.wordClouds).toEqual([]);
  expect(env.summaries).toEqual([]);
  expect(readDanmuSession(1, { rootDir: env.rootDir })?.endedAt).toBeNull();

  // 第 6 分钟重新开播：发普通消息不带 @all
  await captured.handlers?.onLiveStart({
    timestamp: new Date(T0.getTime() + 18 * 60 * 1000),
    hasLiveTime: true,
  });
  expect(env.sent).toHaveLength(2);
  expect(env.sent[1]).toEqual({
    groupId: 200001,
    purpose: "live.resume",
    text: "饭总开播了 https://live.bilibili.com/4629447",
    hasAtAll: false,
  });

  await env.cleanup();
});

test("未开启弹幕词云时，超管切断仍会记录到数据库供站点展示", async () => {
  vi.useFakeTimers();
  const env = await setupEnv({ withWordCloud: false });

  await captured.handlers?.onLiveStart({ timestamp: T0, hasLiveTime: true });
  await captured.handlers?.onRoomCutOff({
    timestamp: new Date(T0.getTime() + 5 * 60 * 1000),
    reason: "未开词云切断",
  });

  const latest = readLatestCutOffByRooms({ rootDir: env.rootDir });
  expect(latest).toHaveLength(1);
  expect(latest[0]).toMatchObject({
    sessionId: null,
    roomId: "4629447",
    reason: "未开词云切断",
  });

  await env.cleanup();
});
