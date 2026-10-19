import { readDanmuMessages, readDanmuSession } from "@nana/storage";
import type { StorageOptions } from "@nana/storage";
import { extractWords, summarizeSession } from "@nana/wordcloud";
import type { DanmuSessionSummary, ExtractWordsOptions, WordCount } from "@nana/wordcloud";
import type { WordCloudConfig } from "./config.ts";

/** 词云清洗规则：主播名当噪音词过滤，配置里的额外停用词 / 噪音词一并叠加。 */
export function toWordOptions(config: WordCloudConfig, streamer: string): ExtractWordsOptions {
  return {
    extraStopWords: config.stopWords,
    extraNoiseWords: [streamer, ...config.noiseWords],
    minLength: config.minWordLength,
  };
}

/**
 * 读取一场直播的全部弹幕，产出推送用的场次统计；场次不存在时返回 undefined。
 *
 * 主播名会被当作噪音词过滤，避免「饭总」这类固定称谓霸榜。
 */
export function buildWordCloudSummary(
  sessionId: number,
  streamer: string,
  config: WordCloudConfig,
  storage: StorageOptions = {},
): DanmuSessionSummary | undefined {
  const session = readDanmuSession(sessionId, storage);
  if (!session) {
    return undefined;
  }

  const messages = readDanmuMessages(session.id, storage).map((message) => ({
    userId: message.userId,
    username: message.username,
    content: message.content,
  }));

  return summarizeSession(
    {
      streamer,
      roomId: Number(session.roomId),
      // 场次还没结束时按当前时间统计，避免出现负数时长。
      endedAt: session.endedAt ?? new Date().toISOString(),
      startedAt: session.startedAt,
      messages,
    },
    {
      topWords: config.topN,
      words: toWordOptions(config, streamer),
    },
  );
}

/** 只取词频（调试 / 面板复用），清洗规则与推送时完全一致。 */
export function extractSessionWords(
  sessionId: number,
  streamer: string,
  config: WordCloudConfig,
  storage: StorageOptions = {},
): WordCount[] {
  return extractWords(
    readDanmuMessages(sessionId, storage).map((message) => message.content),
    { ...toWordOptions(config, streamer), topN: config.topN },
  );
}
