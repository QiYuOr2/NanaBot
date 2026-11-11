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

    // QQ 在线层：心跳携带 status.online，连续 confirmCount 次离线才判定掉线；恢复也以心跳为准。
    // 官方连接无 OneBot 心跳；持续断连达到兜底时长才告警，READY/RESUMED 即恢复。
    if (context.onConnectionState) {
      context.onConnectionState((connected) => {
        if (connected) {
          cancelRecoveryFallback();
          void dispatch(detector.reportConnectionRestored("qq.official.connected"));
        } else if (recoveryTimer === undefined) {
          recoveryTimer = setTimeout(() => {
            recoveryTimer = undefined;
            void dispatch(detector.reportConnectionLost("qq.official.disconnected"));
          }, recoveryFallbackMs);
        }
      });
      return async () => {
        cancelRecoveryFallback();
        await notifier.close?.();
      };
    }

    context.on?.("meta_event.heartbeat", async (event) => {
      cancelRecoveryFallback();
      await dispatch(detector.reportHeartbeat(event.status.online !== false));
    });

    // WebSocket 层：连接断开后每个重连尝试都会触发一次 close，达到确认阈值才告警。
    context.on?.("socket.close", async (event) => {
      if (event.reconnection.nowAttempts >= confirmCount) {
        await dispatch(detector.reportConnectionLost("socket.close"));
      }
    });

    // WebSocket 层重连成功。注意「WS 回来」不等于「QQ 回来」：QQ 仍离线时直接判恢复会先发出
    // 一封假的恢复邮件，随后又被心跳判回离线，WS 每抖动一次就来回刷一对邮件。所以这里只等
    // 下一次心跳用 status.online 定论，仅当迟迟没有心跳（未配置心跳的部署）才退回旧行为。
    context.on?.("socket.open", () => {
      cancelRecoveryFallback();
      recoveryTimer = setTimeout(() => {
        recoveryTimer = undefined;
        void dispatch(detector.reportConnectionRestored("socket.open"));
      }, recoveryFallbackMs);
    });

    return async () => {
      cancelRecoveryFallback();
      await notifier.close?.();
    };
  },
});
