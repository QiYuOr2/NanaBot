import { readConfig, updateConfig } from "@nana/config";
import { z } from "zod";

/** 单次词云推送的默认展示词数。 */
export const DEFAULT_WORDCLOUD_TOP_N = 60;
/** 下播兜底轮询的默认间隔（毫秒）。 */
export const DEFAULT_WORDCLOUD_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 全局词云的分词与渲染参数。
 *
 * 是否录制、推到哪些群不在这里，写在对应主播的 `wordcloud` 上。
 */
export interface WordCloudConfig {
  /** 词云展示词数。 */
  topN: number;
  /** 参与统计的最短词长。 */
  minWordLength: number;
  /** 额外停用词。 */
  stopWords: string[];
  /** 额外噪音词（礼物口令、口头禅等）；主播名会自动加入。 */
  noiseWords: string[];
  /** 中文字体文件路径，缺省时由渲染层挑选系统字体。 */
  fontPath?: string;
  /** 下播兜底轮询间隔（毫秒），设为 0 关闭轮询。 */
  pollIntervalMs: number;
}

const WordCloudConfigFieldsSchema = z.object({
  topN: z.number().int().positive().default(DEFAULT_WORDCLOUD_TOP_N),
  minWordLength: z.number().int().min(1).default(2),
  stopWords: z.array(z.string()).default([]),
  noiseWords: z.array(z.string()).default([]),
  fontPath: z.string().optional(),
  pollIntervalMs: z.number().int().min(0).default(DEFAULT_WORDCLOUD_POLL_INTERVAL_MS),
});

type WordCloudConfigFields = z.infer<typeof WordCloudConfigFieldsSchema>;

/** `wordcloud` 段整体缺失（老配置文件）时使用的默认值。 */
const DEFAULT_WORDCLOUD_FIELDS: WordCloudConfigFields = {
  topN: DEFAULT_WORDCLOUD_TOP_N,
  minWordLength: 2,
  stopWords: [],
  noiseWords: [],
  pollIntervalMs: DEFAULT_WORDCLOUD_POLL_INTERVAL_MS,
};

const WordCloudConfigSchema = z.object({
  wordcloud: WordCloudConfigFieldsSchema.optional(),
});

/** 从 `nana.config.yaml` 的全局 `wordcloud` 段读取分词与渲染配置；该段缺失时使用默认值。 */
export function loadWordCloudConfig(): WordCloudConfig {
  const config = WordCloudConfigSchema.parse(readConfig()).wordcloud ?? DEFAULT_WORDCLOUD_FIELDS;

  return {
    topN: config.topN,
    minWordLength: config.minWordLength,
    stopWords: config.stopWords,
    noiseWords: config.noiseWords,
    fontPath: config.fontPath || undefined,
    pollIntervalMs: config.pollIntervalMs,
  };
}

/** 把词云的分词与渲染配置写回 `nana.config.yaml`。 */
export function saveWordCloudConfig(config: WordCloudConfig): string {
  return updateConfig("wordcloud", config);
}
