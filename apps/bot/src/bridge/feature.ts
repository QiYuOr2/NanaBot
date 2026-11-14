import { defineFeature } from "../core/feature.ts";
import type { BridgeStore } from "./store.ts";

export interface BridgeFeatureOptions {
  store: BridgeStore;
}

/**
 * Rei 桥接：把主人的私聊记录下来，供 Rei 经控制接口读取与回复。
 *
 * 安全边界都在这里收口：
 * - 只处理私聊（scene === "private"），群消息一律不碰；
 * - 未绑定主人时只记录候选发送者，不进入消息流；
 * - 绑定后只接受主人本人的消息，其他人的私聊直接忽略。
 * 消息正文不写日志，只记发送者与 seq。
 */
export const bridgeFeature = defineFeature<BridgeFeatureOptions>({
  name: "bridge",
  setup(context, options) {
    context.onMessage((message) => {
      if (message.scene !== "private") return;
      const state = options.store.read();
      if (!state.ownerId) {
        options.store.addCandidate(message);
        context.logger.info(
          `[bridge] 收到未绑定发送者的私聊候选（${message.senderId}），等待绑定确认`,
        );
        return;
      }
      if (message.senderId !== state.ownerId) return;
      const record = options.store.recordInbound(message);
      context.logger.info(`[bridge] 已记录主人私聊 seq=${record.seq}`);
    });
  },
});
