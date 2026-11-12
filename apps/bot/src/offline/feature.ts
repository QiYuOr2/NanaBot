import { consoleLogger, defineFeature, type FeatureContext } from "../core";
import type { Notifier } from "@nana/notify";
import { createCompositeNotifier } from "@nana/notify";
import type { OfflineAlert, OfflineStateStore } from "@nana/offline-detector";
import { OfflineDetector, renderOfflineAlert } from "@nana/offline-detector";
import { appendOfflineAlert, type StorageOptions } from "@nana/storage";
import { createOfflineStateStore } from "./store.ts";

/** 重连成功后迟迟收不到心跳时的兜底时长（毫秒）。 */
export const DEFAULT_RECOVERY_FALLBACK_MS = 90_000;

export interface OfflineDetectorOptions {
  notifier: Notifier | Notifier[];
  confirmCount?: number;
  notifyRecovery?: boolean;
  /** 离线状态存储，缺省写入项目 `db/`；测试可注入隔离实现。 */
  store?: OfflineStateStore;
  /** 告警历史的库位置，与状态存储同一份 `db/`。测试可指向临时目录。 */
  storage?: StorageOptions;
  /** 记下这条告警，供站点告警页读取。缺省写入 `app-state.sqlite`。 */
  recordAlert?: (alert: OfflineAlert) => void;
  /**
   * 重连后等多久没有心跳就退回「重连即恢复」，默认 {@link DEFAULT_RECOVERY_FALLBACK_MS}。
   * 正常配置下 NapCat 的心跳远快于这个值，计时器会被心跳清掉。
   */
  recoveryFallbackMs?: number;
}

export const offlineDetectorFeature = defineFeature<OfflineDetectorOptions>({
  name: "离线检测告警",
  setup(context: FeatureContext, options) {
    const logger = context.logger ?? consoleLogger;
    const notifier = Array.isArray(options.notifier)
      ? createCompositeNotifier(options.notifier)
      : options.notifier;
    const confirmCount = options.confirmCount ?? 3;
    const recoveryFallbackMs = options.recoveryFallbackMs ?? DEFAULT_RECOVERY_FALLBACK_MS;
    const detector = new OfflineDetector({
      store: options.store ?? createOfflineStateStore(),
      confirmCount,
      notifyRecovery: options.notifyRecovery,
    });

    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelRecoveryFallback = () => {
      if (recoveryTimer !== undefined) {
        clearTimeout(recoveryTimer);
        recoveryTimer = undefined;
      }
    };

    const recordAlert =
      options.recordAlert ??
      ((alert: OfflineAlert) => {
        appendOfflineAlert(
          {
            kind: alert.kind,
            offlineSince: alert.offlineSince,
            downtimeMs: alert.downtimeMs,
            reason: alert.reason,
          },
          options.storage,
        );
      });

    async function dispatch(result: OfflineAlert | undefined): Promise<void> {
      if (!result) {
        return;
      }
      try {
        recordAlert(result);
      } catch (error) {
        logger.error("[离线检测] 记录告警失败", error);
      }
      try {
        await notifier.send(renderOfflineAlert(result));
      } catch (error) {
        logger.error("[离线检测] 发送告警失败", error);
      }
    }

    context.onConnectionState((state) => {
      if (state.platform === "official") {
        if (state.connected) {
          cancelRecoveryFallback();
          void dispatch(detector.reportConnectionRestored("qq.official.connected"));
        } else if (recoveryTimer === undefined) {
          recoveryTimer = setTimeout(() => {
            recoveryTimer = undefined;
            void dispatch(detector.reportConnectionLost("qq.official.disconnected"));
          }, recoveryFallbackMs);
        }
        return;
      }
      if (state.connected) {
        cancelRecoveryFallback();
        recoveryTimer = setTimeout(() => {
          recoveryTimer = undefined;
          void dispatch(detector.reportConnectionRestored("socket.open"));
        }, recoveryFallbackMs);
        return;
      }
      if (state.phase === "disconnected" && (state.reconnectAttempts ?? 0) >= confirmCount) {
        void dispatch(detector.reportConnectionLost("socket.close"));
      }
    });
    context.onHeartbeat?.((online) => {
      cancelRecoveryFallback();
      void dispatch(detector.reportHeartbeat(online));
    });

    return async () => {
      cancelRecoveryFallback();
      await notifier.close?.();
    };
  },
});
