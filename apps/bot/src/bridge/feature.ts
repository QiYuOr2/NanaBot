import { defineFeature } from "../core/feature.ts";
import type { BridgeStore } from "./store.ts";

export interface BridgeFeatureOptions {
  store: BridgeStore;
}

/**
 * Rei 桥接：把主人的私聊与群里 @ 到 bot 的消息记录下来，供 Rei 经控制接口读取与回复。
 *
 * 安全边界都在这里收口：
 * - 私聊：未绑定主人时只记录候选发送者；绑定后只接受主人本人的消息，其他人直接忽略；
 * - 群聊：不限定群与发送者，但只收 @ 到 bot 的消息（isAtBot）。官方通道本身只投递
 *   @ 消息，NapCat 通道靠这个标记避免把整群聊天都录下来；
 * - 群记录不需要先绑定主人，任何群里被 @ 都会自动建档。
 * 消息正文不写日志，只记发送者与 seq。
 */
export const bridgeFeature = defineFeature<BridgeFeatureOptions>({
  name: "bridge",
  setup(context, options) {
    context.onMessage((message) => {
      if (message.scene === "group") {
        if (!message.isAtBot) return;
        const record = options.store.recordGroupInbound(message);
        context.logger.info(
          `[bridge] 已记录群 @ 消息 seq=${record.seq}（群 ${message.conversationId}）`,
        );
        return;
      }
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
