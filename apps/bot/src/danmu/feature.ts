import { live } from "@nana/bilibili-api";
import type { MonitorSink } from "@nana/monitor";
import { closeDanmuSession, findActiveDanmuSession } from "@nana/storage";
import { dateFormat } from "@nana/utils";
import { defineFeature } from "../core/feature.ts";
import type { FeatureContext } from "../core/feature.ts";
import type { MonitorStreamerConfig } from "../monitor/config.ts";
import type {
  LiveStatusChecker,
  ResumeDanmuOptions,
  WordCloudFeatureOptions,
} from "./featureTypes.ts";
import { publishWordCloud } from "./publish.ts";
import { createDanmuSink, DanmuRecorder } from "./recorder.ts";

export type {
  LiveStatusChecker,
  ResumeDanmuOptions,
  WordCloudFeatureOptions,
} from "./featureTypes.ts";

/** 通过 B 站接口判断主播当前是否在播（`live_status === 1`）。 */
export async function fetchIsLive(
  streamer: MonitorStreamerConfig,
  fetch?: typeof globalThis.fetch,
): Promise<boolean> {
  const statusByUid = await live.getLiveStatusByUids([streamer.uid], { fetch });
  return statusByUid[String(streamer.uid)]?.live_status === 1;
}

const logger = {
  log(message: string) {
    console.log(`[${dateFormat(Date.now())}] ${message}`);
  },
  error(message: string, error?: unknown) {
    console.error(message, error);
  },
};

/**
 * 弹幕录制与词云推送功能。
 *
 * **不自建长连接**：所有事件都来自 `monitorFeature` 为每个主播建立的同一条 blive 连接，
 * 这里只通过 {@link createWordCloudMonitorSink} 往那条连接上挂一个 sink，保证
 * 「开播通知」和「弹幕录制」用的是同一个直播间的同一份事件流。
 */
export const wordCloudFeature = defineFeature<WordCloudFeatureOptions>({
  name: "弹幕词云",
  setup(_context: FeatureContext, options) {
    // 与 sink 工厂共用同一张表。录制器在监控启动后才写入，轮询和停机必须看到后补上的项。
    const recorders = options.recorders ?? new Map<number, DanmuRecorder>();
    const isLive: LiveStatusChecker =
      options.isLive ?? ((streamer) => fetchIsLive(streamer, options.fetch));
    const unrefTimers = options.unrefTimers ?? true;

    let pollTimer: ReturnType<typeof setInterval> | undefined;
    if (options.config.pollIntervalMs > 0) {
      pollTimer = setInterval(() => {
        void pollActiveRecorders(recorders, options.streamers, isLive);
      }, options.config.pollIntervalMs);
      if (unrefTimers) {
        pollTimer.unref?.();
      }
    }

    return async () => {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      // 停机时把仍在录制的场次收尾并推送，避免整场数据丢失。
      await Promise.all([...recorders.values()].map((recorder) => recorder.shutdown()));
      recorders.clear();
    };
  },
});

/**
 * 为直播监控的共享长连接创建弹幕 sink。
 *
 * 在同一份事件流上：`live.started` 开录、`danmu.received` 落库、`live.ended` 收尾并推送。
 * 录制器会被放进 `recorders`，供 `wordCloudFeature` 的轮询兜底与停机收尾复用。
 */
export function createWordCloudMonitorSink(
  options: WordCloudFeatureOptions,
  recorders: Map<number, DanmuRecorder>,
): (streamer: Pick<MonitorStreamerConfig, "roomId" | "streamer">) => MonitorSink | undefined {
  if (options.notifyGroupId !== undefined && options.sendAdminMsg === undefined) {
    throw new Error(
      "词云已配置管理员群，但没有注入 sendAdminMsg。下播、轮询和停机都不会把词云发到管理群。",
    );
  }

  const sendAdminMsg = options.sendAdminMsg ?? unavailableSender;

  return (streamer) => {
    // `monitorFeature` 传入的是 `MonitorFeatureOptions`，只带 roomId/streamer/uid；
    // 这里按 roomId 匹配配置里的主播，用配置里的完整信息建录制器。
    const configured = options.streamers.find((item) => item.roomId === streamer.roomId);
    if (!configured) {
      return undefined;
    }

    const recorder = new DanmuRecorder({
      roomId: configured.roomId,
      streamer: configured.streamer,
      config: options.config,
      notifyGroupId: options.notifyGroupId,
      sendAdminMsg,
      rootDir: options.rootDir,
    });
    recorders.set(configured.roomId, recorder);

    return createDanmuSink(recorder);
  };
}

/** 轮询兜底：有活跃场次但 B 站已不在播，就收尾并推送词云。 */
async function pollActiveRecorders(
  recorders: Map<number, DanmuRecorder>,
  streamers: MonitorStreamerConfig[],
  isLive: LiveStatusChecker,
): Promise<void> {
  for (const streamer of streamers) {
    const recorder = recorders.get(streamer.roomId);
    if (!recorder?.active) {
      continue;
    }

    let liveNow: boolean;
    try {
      liveNow = await isLive(streamer);
    } catch (error) {
      logger.error(`[弹幕词云] 查询直播间 ${streamer.roomId} 状态失败`, error);
      continue;
    }

    if (liveNow) {
      continue;
    }

    logger.log(`[弹幕词云] 轮询发现 ${streamer.streamer} 已下播，收尾本场记录`);
    await recorder.finish("poll");
  }
}

/** 启动时处理上一进程遗留的未结束场次。 */
export async function resumeDanmuSessions(options: ResumeDanmuOptions): Promise<void> {
  const isLive: LiveStatusChecker =
    options.isLive ?? ((streamer) => fetchIsLive(streamer, options.fetch));
  const now = options.now ?? (() => new Date());
  const sendAdminMsg = options.sendAdminMsg ?? unavailableSender;
  const endedAt = now().toISOString();

  for (const streamer of options.streamers) {
    const session = findActiveDanmuSession(streamer.roomId, options);
    if (!session) {
      continue;
    }

    let liveNow: boolean;
    try {
      liveNow = await isLive(streamer);
    } catch (error) {
      console.warn(
        `[弹幕词云] 查询 ${streamer.streamer} 的直播状态失败，保留场次 #${session.id} 交给轮询收尾`,
        error,
      );
      continue;
    }

    if (liveNow) {
      console.log(`[弹幕词云] ${streamer.streamer} 仍在直播，继续记录场次 #${session.id}`);
      continue;
    }

    // 必须先把场次收尾，否则下一次启动会再次补发同一场的词云。
    closeDanmuSession(
      session.id,
      { endedAt: endedAt, reason: "stale" },
      { rootDir: options.rootDir },
    );
    logger.log(
      `[弹幕词云] ${streamer.streamer} 已下播，补收尾遗留场次 #${session.id}（${endedAt}）`,
    );
    await publishWordCloud({
      sessionId: session.id,
      streamer: streamer.streamer,
      config: options.config,
      notifyGroupId: options.notifyGroupId,
      sendAdminMsg,
      closeReason: "stale",
      rootDir: options.rootDir,
    });
  }
}

/** 调用方忘了注入发送函数。实时推送必须传入发往管理员群的 `sendAdminMsg`。 */
async function unavailableSender(): Promise<void> {
  throw new Error("未注入词云发送函数，无法推送到管理群");
}
