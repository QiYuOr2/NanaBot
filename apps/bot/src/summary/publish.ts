import { textPart } from "../message/parts.ts";
import { listUnpushedLiveSummaries, markLiveSummaryPushed } from "@nana/storage";
import type { StorageOptions } from "@nana/storage";
import { renderLiveSummaryMessage, settleLiveSummary } from "@nana/live-summary";
import { consoleLogger, type Logger } from "../core/logger.ts";
import type { WordCloudSender } from "../danmu/types.ts";

export interface PublishLiveSummaryOptions extends StorageOptions {
  sessionId: number;
  streamer: string;
  /** 开播通知群。空数组表示只落库，不发群。 */
  notifyGroupIds: number[];
  send: WordCloudSender;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  logger?: Logger;
}

/**
 * 为一场已结束的直播生成摘要，并只在这次由机器人新写成成功摘要时发到开播通知群。
 *
 * 页面已经生成过、没有弹幕、或生成失败时都不发，避免同一场出现两份不同的群消息。
 */
export async function publishLiveSummary(options: PublishLiveSummaryOptions): Promise<void> {
  const logger = options.logger ?? consoleLogger;
  const storage: StorageOptions = { rootDir: options.rootDir };
  const settled = await settleLiveSummary({
    sessionId: options.sessionId,
    source: "bot",
    apiKey: options.apiKey,
    rootDir: options.rootDir,
    fetch: options.fetch,
  });

  if (settled.kind !== "ready" || !settled.shouldPush || !settled.text) {
    if (settled.kind === "ready" && settled.message) {
      logger.warn(
        `[直播摘要] ${options.streamer} 场次 #${options.sessionId} 未推送：${settled.message}`,
      );
    }
    return;
  }

  await deliverLiveSummary(
    options.notifyGroupIds,
    options.streamer,
    settled.text,
    options.send,
    logger,
  );
  markLiveSummaryPushed(options.sessionId, storage);
}

export interface PushUnsentLiveSummaryOptions extends StorageOptions {
  streamers: readonly {
    roomId: number;
    streamer: string;
    notifyEnabled: boolean;
    notifyGroups: number[];
  }[];
  send: WordCloudSender;
  /** 只补发这些直播间的摘要；多账号按账号分批补发时使用。 */
  roomIds?: ReadonlySet<number>;
  logger?: Logger;
}

/** 补发上一进程写好但还没发出去的机器人摘要。页面生成的摘要不在此列。 */
export async function pushUnsentLiveSummaries(
  options: PushUnsentLiveSummaryOptions,
): Promise<void> {
  const logger = options.logger ?? consoleLogger;
  const storage: StorageOptions = { rootDir: options.rootDir };
  const pending = listUnpushedLiveSummaries(storage);

  for (const item of pending) {
    if (options.roomIds && !options.roomIds.has(Number(item.roomId))) {
      continue;
    }
    const streamer = options.streamers.find((entry) => String(entry.roomId) === item.roomId);
    const groups = streamer?.notifyEnabled ? streamer.notifyGroups : [];
    await deliverLiveSummary(groups, item.streamer, item.text, options.send, logger);
    markLiveSummaryPushed(item.id, storage);
  }
}

async function deliverLiveSummary(
  groupIds: readonly number[],
  streamer: string,
  text: string,
  send: WordCloudSender,
  logger: Logger,
): Promise<void> {
  const message = renderLiveSummaryMessage(text);
  if (groupIds.length === 0) {
    logger.warn(`[直播摘要] ${streamer} 没有开播通知群，摘要只保留在页面`);
    return;
  }

  for (const groupId of groupIds) {
    try {
      await send(groupId, [textPart(message)], {
        purpose: "live.summary",
        content: message,
        subject: streamer,
      });
    } catch (error) {
      logger.error(`[直播摘要] 发到群 ${groupId} 失败`, error);
    }
  }
}
