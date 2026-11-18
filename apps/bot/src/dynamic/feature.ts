import { dynamic as bilibiliDynamic } from "@nana/bilibili-api";
import { defineFeature, type FeatureContext } from "../core/index.ts";
import type { StorageOptions } from "@nana/storage";
import {
  flushPendingDynamics,
  pollStreamerOnce,
  type DynamicFetcher,
  type DynamicLogger,
} from "./monitor.ts";
import { DynamicScheduler } from "./scheduler.ts";
import { sendDynamicToGroups, type QQProvider } from "./sender.ts";
import type { DynamicStreamerConfig } from "./config.ts";

/** 动态监控功能的注册参数（作为 `app.use` 的 options）。 */
export interface DynamicFeatureRegistration extends StorageOptions {
  /** 当前账号使用的 QQ 通道，决定图片发送能力。 */
  provider: QQProvider;
  /** 该账号下的动态监控 UP 主。 */
  streamers: DynamicStreamerConfig[];
  /** 全局并发上限。 */
  concurrency: number;
  /** 覆盖动态 API 客户端，便于测试。 */
  fetcher?: DynamicFetcher;
  /** 覆盖发送实现，便于测试。 */
  pusher?: Parameters<typeof flushPendingDynamics>[0]["pusher"];
}

function createDefaultFetch(): DynamicFetcher {
  return new bilibiliDynamic.BilibiliDynamicClient();
}

/** 把 FeatureContext 的 logger 适配成 DynamicLogger。 */
function toDynamicLogger(context: FeatureContext): DynamicLogger {
  return {
    info: (message, error) => context.logger.info(message, error),
    warn: (message, error) => context.logger.warn(message, error),
    error: (message, error) => context.logger.error(message, error),
  };
}

/** outbox 定期重试间隔（毫秒）：兜住失败项与启动恢复。 */
const FLUSH_INTERVAL_MS = 60_000;

/**
 * 动态监控功能：为该账号下的 UP 主建立统一轮询调度，并把新动态推送到配置群。
 *
 * 生命周期：`setup` 时创建调度器、注册任务、恢复 pending、启动；返回的 cleanup 会在
 * 应用 `stop()` 时停止调度与在途请求。动态监控与直播间长连接完全独立。
 */
export const createDynamicMonitorFeature = defineFeature<DynamicFeatureRegistration>({
  name: "动态监控",
  setup(context, registration) {
    const logger = toDynamicLogger(context);
    const storage: StorageOptions = { rootDir: registration.rootDir };
    const fetcher = registration.fetcher ?? createDefaultFetch();
    const streamerByUid = new Map(
      registration.streamers.map((streamer) => [streamer.uid, streamer]),
    );

    const routeFor = (uid: number) => {
      const target = streamerByUid.get(uid);
      if (!target) return undefined;
      return { notifyGroups: target.notifyGroups, enableNotify: target.enableNotify };
    };

    const pusher =
      registration.pusher ??
      ((formatted, groupIds) =>
        sendDynamicToGroups({ context, provider: registration.provider }, formatted, groupIds));

    const scheduler = new DynamicScheduler({
      concurrency: registration.concurrency,
      logger,
    });

    for (const streamer of registration.streamers) {
      scheduler.schedule({
        key: streamer.uid,
        intervalMinutes: streamer.pollIntervalMinutes,
        run: async () => {
          await pollStreamerOnce({
            streamer: {
              uid: streamer.uid,
              streamer: streamer.streamer,
              notifyGroups: streamer.notifyGroups,
              enableNotify: streamer.enableNotify,
              types: streamer.types,
            },
            fetcher,
            storage,
            logger,
            now: () => new Date(),
          });
          // 每轮轮询后立即尝试发送该 UID 新入队的 pending。
          await flushPendingDynamics({
            storage,
            pusher,
            logger,
            now: () => new Date(),
            uids: new Set([streamer.uid]),
            routeFor,
          });
        },
      });
    }

    // 启动时先恢复上次进程遗留的 pending，再开始定时轮询。
    void flushPendingDynamics({ storage, pusher, logger, now: () => new Date(), routeFor }).catch(
      (error) => logger.error("[动态监控] 恢复待推送动态失败", error),
    );

    const flushTimer = setInterval(() => {
      void flushPendingDynamics({
        storage,
        pusher,
        logger,
        now: () => new Date(),
        routeFor,
      }).catch((error) => logger.error("[动态监控] 定期重试待推送动态失败", error));
    }, FLUSH_INTERVAL_MS);
    (flushTimer as { unref?: () => void }).unref?.();

    scheduler.start();
    logger.info(
      `[动态监控] 账号 ${context.accountId} 启动 ${registration.streamers.length} 个 UP 主动态监控`,
    );

    return () => {
      clearInterval(flushTimer);
      scheduler.stop();
      logger.info(`[动态监控] 账号 ${context.accountId} 已停止动态监控`);
    };
  },
});
