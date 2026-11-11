import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Structs } from "node-napcat-ts";
import type { StorageOptions } from "@nana/storage";
import { buildWordCloudSvg, renderSessionMessage, renderWordCloudPng } from "@nana/wordcloud";
import type { WordCount } from "@nana/wordcloud";
import { consoleLogger, type Logger } from "../core/logger.ts";
import type { WordCloudConfig } from "./config.ts";
import type { WordCloudPublishOptions } from "./types.ts";
import { buildWordCloudSummary } from "./wordCloud.ts";

/** 文案里展示的 Top 词数量；完整词表在词云图里。 */
export const DEFAULT_MESSAGE_TOP_WORDS = 10;

/** 渲染词云 PNG 到临时文件；渲染失败返回 undefined，由调用方降级为纯文字。 */
export async function renderWordCloudImage(
  words: readonly WordCount[],
  config: WordCloudConfig,
  logger: Logger = consoleLogger,
): Promise<string | undefined> {
  if (words.length === 0) {
    return undefined;
  }

  try {
    const svg = buildWordCloudSvg(words, { maxWords: config.topN });
    const png = await renderWordCloudPng(svg, { fontPath: config.fontPath });
    const filePath = join(
      tmpdir(),
      `nana-wordcloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
    );
    writeFileSync(filePath, png);
    return filePath;
  } catch (error) {
    logger.error("[弹幕词云] 渲染词云图片失败，降级为纯文字", error);
    return undefined;
  }
}

/**
 * 生成一场直播的词云摘要，并推送到该主播配置的群。
 *
 * 每个群各自：文字 + 图片 →（图片渲染或发送失败）纯文字 →（文字也失败）只记日志，不影响其他群。
 * 场次不存在或该主播没有推送群时不推送。
 */
export async function publishWordCloud(options: WordCloudPublishOptions): Promise<void> {
  const { sessionId, streamer, config, notifyGroupIds, sendWordCloud } = options;
  const logger = options.logger ?? consoleLogger;
  const storage: StorageOptions = { rootDir: options.rootDir };
  const summary = buildWordCloudSummary(sessionId, streamer, config, storage);
  if (!summary) {
    logger.warn(`[弹幕词云] 场次 #${sessionId} 不存在，跳过推送`);
    return;
  }

  if (notifyGroupIds.length === 0) {
    logger.warn(`[弹幕词云] ${streamer} 未配置推送群，跳过词云推送`);
    return;
  }

  const message = renderSessionMessage(summary, {
    topWords: options.topWords ?? DEFAULT_MESSAGE_TOP_WORDS,
  });
  const purpose = {
    purpose: options.purpose ?? ("wordcloud" as const),
    content: message.text,
    subject: streamer,
  };

  const imagePath = await renderWordCloudImage(summary.topWords, config, logger);
  try {
    for (const groupId of notifyGroupIds) {
      await deliverWordCloud(
        groupId,
        message.text,
        imagePath,
        purpose,
        sendWordCloud,
        sessionId,
        logger,
      );
    }
  } finally {
    if (imagePath) {
      removeQuietly(imagePath, logger);
    }
  }
}

/** 发到一个群。图片发送失败时改发纯文字，文字也失败则只记日志。 */
async function deliverWordCloud(
  groupId: number,
  text: string,
  imagePath: string | undefined,
  purpose: NonNullable<Parameters<WordCloudPublishOptions["sendWordCloud"]>[2]>,
  sendWordCloud: WordCloudPublishOptions["sendWordCloud"],
  sessionId: number,
  logger: Logger,
): Promise<void> {
  if (imagePath) {
    try {
      await sendWordCloud(groupId, [Structs.text(text), Structs.image(imagePath)], purpose);
      return;
    } catch (error) {
      logger.error(
        `[弹幕词云] 场次 #${sessionId} 向群 ${groupId} 发送词云图片失败，降级为纯文字`,
        error,
      );
    }
  }

  try {
    await sendWordCloud(groupId, [Structs.text(text)], purpose);
  } catch (error) {
    logger.error(`[弹幕词云] 场次 #${sessionId} 向群 ${groupId} 推送词云失败`, error);
  }
}

function removeQuietly(filePath: string, logger: Logger): void {
  try {
    rmSync(filePath, { force: true });
  } catch (error) {
    logger.error("[弹幕词云] 清理临时图片失败", error);
  }
}
