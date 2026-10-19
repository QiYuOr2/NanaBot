import { readConfig, updateConfig } from "@nana/config";
import { z } from "zod";

/** 单次词云推送的默认展示词数。 */
export const DEFAULT_WORDCLOUD_TOP_N = 60;
/** 下播兜底轮询的默认间隔（毫秒）。 */
export const DEFAULT_WORDCLOUD_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface WordCloudConfig {
  /** 是否启用整场弹幕记录与词云推送。 */
  enabled: boolean;
  /** 词云推送目标群；缺省时使用 `ADM_GROUP`。 */
  notifyGroupId?: number;
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
  enabled: z.boolean().default(true),
  notifyGroupId: z.number().int().positive().optional(),
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
  enabled: true,
  topN: DEFAULT_WORDCLOUD_TOP_N,
  minWordLength: 2,
  stopWords: [],
  noiseWords: [],
  pollIntervalMs: DEFAULT_WORDCLOUD_POLL_INTERVAL_MS,
};

const WordCloudConfigSchema = z.object({
  wordcloud: WordCloudConfigFieldsSchema.optional(),
});

/** 从 `nana.config.yaml` 的 `wordcloud` 段读取词云配置；该段缺失时使用默认值。 */
export function loadWordCloudConfig(): WordCloudConfig {
  const config = WordCloudConfigSchema.parse(readConfig()).wordcloud ?? DEFAULT_WORDCLOUD_FIELDS;

  return {
    enabled: config.enabled,
    notifyGroupId: config.notifyGroupId,
    topN: config.topN,
    minWordLength: config.minWordLength,
    stopWords: config.stopWords,
    noiseWords: config.noiseWords,
    fontPath: config.fontPath || undefined,
    pollIntervalMs: config.pollIntervalMs,
  };
}

/** 把词云配置写回 `nana.config.yaml`，便于手工调整后持久化。 */
export function saveWordCloudConfig(config: WordCloudConfig): string {
  return updateConfig("wordcloud", config);
}
