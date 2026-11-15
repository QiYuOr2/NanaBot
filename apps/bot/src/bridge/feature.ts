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
 * - 群聊：不限定群。收录两种消息——任何人 @ 到 bot 的消息（isAtBot），以及主人本人
 *   未 @ 的普通发言（发送者与私聊 openid 一致，或与该群绑定的主人标识一致）。
 *   其他人的普通发言一律不录，避免把整群聊天都存下来。主人普通发言被收录后，
 *   Rei 可以自行判断是否主动回复（七宇 2026-11-15 许可，依赖平台的全量消息权限）；
 * - 群记录不需要先绑定主人，任何群里被 @ 都会自动建档。
 * 消息正文不写日志，只记发送者与 seq。
 */
export const bridgeFeature = defineFeature<BridgeFeatureOptions>({
  name: "bridge",
  setup(context, options) {
    context.onMessage((message) => {
      if (message.scene === "group") {
        if (!message.isAtBot) {
          const state = options.store.read();
          const isOwner =
            (state.ownerId !== undefined && message.senderId === state.ownerId) ||
            message.senderId === state.groupOwners[message.conversationId];
          if (!isOwner) return;
        }
        const record = options.store.recordGroupInbound(message);
        context.logger.info(
          `[bridge] 已记录群消息 seq=${record.seq}（群 ${message.conversationId}，atBot=${message.isAtBot}）`,
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
