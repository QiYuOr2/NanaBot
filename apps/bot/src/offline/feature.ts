import { defineFeature, type FeatureContext } from "../core";
import type { Notifier } from "@nana/notify";
import { createCompositeNotifier } from "@nana/notify";
import type { OfflineAlert } from "@nana/offline-detector";
import { OfflineDetector, renderOfflineAlert } from "@nana/offline-detector";
import { createOfflineStateStore } from "./store.ts";

export interface OfflineDetectorOptions {
  notifier: Notifier | Notifier[];
  confirmCount?: number;
  cooldownSeconds?: number;
  notifyRecovery?: boolean;
}

export const offlineDetectorFeature = defineFeature<OfflineDetectorOptions>({
  name: "离线检测告警",
  setup(context: FeatureContext, options) {
    const notifier = Array.isArray(options.notifier)
      ? createCompositeNotifier(options.notifier)
      : options.notifier;
    const confirmCount = options.confirmCount ?? 3;
    const detector = new OfflineDetector({
      store: createOfflineStateStore(),
      confirmCount,
      cooldownMs: options.cooldownSeconds != null ? options.cooldownSeconds * 1000 : undefined,
      notifyRecovery: options.notifyRecovery,
    });

    async function dispatch(result: OfflineAlert | undefined): Promise<void> {
      if (!result) {
        return;
      }
      try {
        await notifier.send(renderOfflineAlert(result));
      } catch (error) {
        console.error("[离线检测] 发送告警失败", error);
      }
    }

    // QQ 在线层：心跳携带 status.online，连续 confirmCount 次离线才判定掉线。
    context.on("meta_event.heartbeat", async (event) => {
      await dispatch(detector.reportHeartbeat(event.status.online !== false));
    });

    // WebSocket 层：连接断开后每个重连尝试都会触发一次 close，达到确认阈值才告警。
    context.on("socket.close", async (event) => {
      if (event.reconnection.nowAttempts >= confirmCount) {
        await dispatch(detector.reportConnectionLost("socket.close"));
      }
    });

    // WebSocket 层重连成功。
    context.on("socket.open", async () => {
      await dispatch(detector.reportConnectionRestored("socket.open"));
    });

    return async () => {
      await notifier.close?.();
    };
  },
});
