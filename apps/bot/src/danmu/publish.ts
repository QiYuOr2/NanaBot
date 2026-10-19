import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Structs } from "node-napcat-ts";
import type { StorageOptions } from "@nana/storage";
import { buildWordCloudSvg, renderSessionMessage, renderWordCloudPng } from "@nana/wordcloud";
import type { WordCount } from "@nana/wordcloud";
import type { WordCloudConfig } from "./config.ts";
import type { WordCloudPublishOptions } from "./types.ts";
import { buildWordCloudSummary } from "./wordCloud.ts";

/** 文案里展示的 Top 词数量；完整词表在词云图里。 */
export const DEFAULT_MESSAGE_TOP_WORDS = 10;

/** 渲染词云 PNG 到临时文件；渲染失败返回 undefined，由调用方降级为纯文字。 */
export async function renderWordCloudImage(
  words: readonly WordCount[],
  config: WordCloudConfig,
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
    console.error("[弹幕词云] 渲染词云图片失败，降级为纯文字", error);
    return undefined;
  }
}

/**
 * 生成一场直播的词云摘要并推送到管理员群。
 *
 * 推送策略：文字 + 图片 →（图片渲染或发送失败）纯文字 →（文字也失败）只记日志。
 * 场次不存在或未配置推送群时不推送。
 */
export async function publishWordCloud(options: WordCloudPublishOptions): Promise<void> {
  const { sessionId, streamer, config, notifyGroupId, sendAdminMsg } = options;
  const storage: StorageOptions = { rootDir: options.rootDir };
  const summary = buildWordCloudSummary(sessionId, streamer, config, storage);
  if (!summary) {
    console.warn(`[弹幕词云] 场次 #${sessionId} 不存在，跳过推送`);
    return;
  }

  if (notifyGroupId === undefined) {
    console.warn("[弹幕词云] 未配置推送群，跳过词云推送");
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

  const imagePath = await renderWordCloudImage(summary.topWords, config);
  if (imagePath) {
    try {
      await sendAdminMsg([Structs.text(message.text), Structs.image(imagePath)], purpose);
      return;
    } catch (error) {
      console.error(`[弹幕词云] 场次 #${sessionId} 发送词云图片失败，降级为纯文字`, error);
    } finally {
      removeQuietly(imagePath);
    }
  }

  try {
    await sendAdminMsg([Structs.text(message.text)], purpose);
  } catch (error) {
    console.error(`[弹幕词云] 场次 #${sessionId} 推送词云失败`, error);
  }
}

function removeQuietly(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch (error) {
    console.error("[弹幕词云] 清理临时图片失败", error);
  }
}
