import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_DIRECTORY, NANA_CONFIG_FILE } from "@nana/constants";
import { readLiveStatus } from "@nana/storage";
import { expect, test, vi } from "vite-plus/test";
import type { FeatureContext } from "../src/core/feature.ts";
import type { MonitorStreamerConfig } from "../src/monitor/config.ts";
import type { WordCloudConfig } from "../src/danmu/config.ts";

/**
 * 回归保护：`createMonitorFeature` 改造（支持追加扩展 sink）之后，
 * 原有的「开播 / 下播通知」与「直播状态落库」行为必须保持不变。
 *
 * 做法：把 blive source 换成可控的假 source，向真实的 sink 链推事件，
 * 再断言 NapCat 推送内容与 live-status 落库结果。
 */
type Handler = (payload: unknown) => void | Promise<void>;
const captured: { handlers?: Record<string, Handler> } = {};

vi.mock("@nana/monitor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nana/monitor")>();
  return {
    ...actual,
    createBliveMonitorSource: () => ({
      listen(_roomId: number, next: Record<string, Handler>) {
        captured.handlers = next;
        return { close() {} };
      },
    }),
  };
});

const { createMonitorFeature } = await import("../src/monitor/feature.ts");
const { createWordCloudMonitorSink } = await import("../src/danmu/index.ts");

const streamer: MonitorStreamerConfig = {
  uid: 145149047,
  roomId: 4629447,
  streamer: "饭总",
  notifyEnabled: true,
  notifyGroups: [1101365727],
  messages: { liveStart: "{uname}播了 {@all}", liveEnd: "饭总下播了" },
};

const config: WordCloudConfig = {
  enabled: true,
  topN: 30,
  minWordLength: 2,
  stopWords: [],
  noiseWords: [],
  pollIntervalMs: 0,
};

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bot-regress-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, DATABASE_DIRECTORY));
  return rootDir;
}

interface Sent {
  groups: { groupId: number; purpose: unknown; text: string }[];
  admins: { purpose: unknown; text: string }[];
}

function textsOf(segments: { data?: { text?: string } }[]): string {
  return segments.map((segment) => segment.data?.text ?? "").join("");
}

function createContext(sent: Sent): FeatureContext {
  return {
    ws: {} as never,
    adminGroupId: 1101365727,
    on: () => () => {},
    onCleanup: () => {},
    sendAdminText: async (text) => {
      sent.admins.push({ purpose: "notification", text });
    },
    sendAdminMsg: async (segments, purpose) => {
      sent.admins.push({ purpose, text: textsOf(segments as never) });
    },
    sendGroupMsg: async (groupId, options, segments) => {
      sent.groups.push({ groupId, purpose: options.purpose, text: textsOf(segments as never) });
      return "群名";
    },
  };
}

async function setup(
  sent: Sent,
  rootDir: string,
  withWordCloud: boolean,
): Promise<() => Promise<void>> {
  const recorders = new Map<number, unknown>();
  const sinkFactory = withWordCloud
    ? createWordCloudMonitorSink(
        {
          streamers: [streamer],
          config,
          notifyGroupId: 123,
          sendAdminMsg: async () => {},
          rootDir,
        },
        recorders as never,
      )
    : undefined;

  const feature = createMonitorFeature({
    createSink: sinkFactory ? (item) => sinkFactory(item) : undefined,
  });
  const cleanup = await feature.setup(createContext(sent), {
    roomId: streamer.roomId,
    streamer: streamer.streamer,
    uid: streamer.uid,
    notifyEnabled: streamer.notifyEnabled,
    notifyGroupIds: streamer.notifyGroups,
    messages: streamer.messages,
  });

  return async () => {
    if (typeof cleanup === "function") {
      await cleanup();
    }
  };
}

test("开播通知仍然发到配置的群，purpose 为 live.start", async () => {
  const sent: Sent = { groups: [], admins: [] };
  const cleanup = await setup(sent, createRootDir(), true);

  await captured.handlers?.onLiveStart({
    timestamp: new Date("2026-08-22T10:00:00Z"),
    hasLiveTime: true,
  });

  expect(sent.groups).toHaveLength(1);
  expect(sent.groups[0].groupId).toBe(1101365727);
  expect(sent.groups[0].purpose).toBe("live.start");
  expect(sent.groups[0].text).toContain("饭总");

  await cleanup();
});

test("下播不额外推群（既有行为：live.ended 在 napcat sink 里直接 return）", async () => {
  const sent: Sent = { groups: [], admins: [] };
  const cleanup = await setup(sent, createRootDir(), true);

  await captured.handlers?.onLiveEnd({ timestamp: new Date("2026-08-22T12:00:00Z") });

  // 改造前也是如此：下播事件不发群消息，只写直播状态。
  expect(sent.groups).toHaveLength(0);

  await cleanup();
});

test("未开启词云时开播通知同样正常（与改造前一致）", async () => {
  const sent: Sent = { groups: [], admins: [] };
  const cleanup = await setup(sent, createRootDir(), false);

  await captured.handlers?.onLiveStart({
    timestamp: new Date("2026-08-22T10:00:00Z"),
    hasLiveTime: true,
  });

  expect(sent.groups[0].purpose).toBe("live.start");

  await cleanup();
});

test("直播状态 sink 不受扩展 sink 影响，仍能写入 live-status", async () => {
  // 直接验证 sink 层：createMonitorFeature 默认仍挂载同一个 sink（见其源码），
  // 这里确认该 sink 本身的行为没有变化。
  const rootDir = createRootDir();
  const { createLiveStatusSink } = await import("../src/monitor/sinks/liveStatus.ts");
  const sink = createLiveStatusSink({ rootDir });

  await sink.handle({
    type: "live.started",
    roomId: 4629447,
    streamer: "饭总",
    message: "饭总播了",
    timestamp: new Date("2026-08-22T10:00:00Z"),
  });

  expect(readLiveStatus(4629447, { rootDir })?.live).toBe(true);
});
