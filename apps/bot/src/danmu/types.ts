import type { PushLogPurpose } from "@nana/constants";
import type { SendMessageSegment } from "node-napcat-ts";
import type { DanmuSessionCloseReason, StorageOptions } from "@nana/storage";
import type { FeatureContext } from "../core";
import type { WordCloudConfig } from "./config.ts";

/** 场次收尾原因（与 `@nana/storage` 保持一致）。 */
export type DanmuCloseReason = DanmuSessionCloseReason;

/** 往管理员群发消息的能力，测试时可以直接桩掉。 */
export type AdminSender = (
  messages: SendMessageSegment[],
  purpose?: { purpose: PushLogPurpose; label?: string; content?: string; subject?: string },
) => Promise<void>;

/** 从 FeatureContext 取出发送能力。 */
export function toAdminSender(context: Pick<FeatureContext, "sendAdminMsg">): AdminSender {
  return (messages, purpose) => context.sendAdminMsg(messages, purpose);
}

export interface WordCloudPublishOptions extends StorageOptions {
  sessionId: number;
  streamer: string;
  config: WordCloudConfig;
  /** 词云推送目标群；缺省时只落库不推送。 */
  notifyGroupId?: number;
  /** 往管理员群发送消息的函数。 */
  sendAdminMsg: AdminSender;
  closeReason: DanmuCloseReason;
  /** 文案里展示的 Top 词数，默认 10；完整词表在图里。 */
  topWords?: number;
  /** 推送目的，默认 `wordcloud`。 */
  purpose?: PushLogPurpose;
}
