import type { PushLogPurpose } from "@nana/constants";
import type { SendMessageSegment } from "node-napcat-ts";
import type { DanmuSessionCloseReason, StorageOptions } from "@nana/storage";
import type { FeatureContext } from "../core";
import type { Logger } from "../core/logger.ts";
import type { WordCloudConfig } from "./config.ts";

/** 场次收尾原因（与 `@nana/storage` 保持一致）。 */
export type DanmuCloseReason = DanmuSessionCloseReason;

/** 把词云发到某个群。目标群来自对应主播的配置，测试时可以直接桩掉。 */
export type WordCloudSender = (
  groupId: number,
  messages: SendMessageSegment[],
  purpose?: { purpose: PushLogPurpose; label?: string; content?: string; subject?: string },
) => Promise<void>;

/** 从 FeatureContext 取出发到指定群的能力。 */
export function toWordCloudSender(context: Pick<FeatureContext, "sendGroupMsg">): WordCloudSender {
  return (groupId, messages, purpose) =>
    context
      .sendGroupMsg(groupId, purpose ?? { purpose: "wordcloud" }, messages)
      .then(() => undefined);
}

export interface WordCloudPublishOptions extends StorageOptions {
  sessionId: number;
  streamer: string;
  config: WordCloudConfig;
  /** 该主播的词云推送目标群；空数组表示只落库不推送。 */
  notifyGroupIds: number[];
  /** 发到指定群的函数。 */
  sendWordCloud: WordCloudSender;
  closeReason: DanmuCloseReason;
  /** 文案里展示的 Top 词数，默认 10；完整词表在图里。 */
  topWords?: number;
  /** 推送目的，默认 `wordcloud`。 */
  purpose?: PushLogPurpose;
  /** 当前账号的日志出口。 */
  logger?: Logger;
}
