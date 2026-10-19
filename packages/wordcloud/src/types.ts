/** 一个词及其出现次数。 */
export interface WordCount {
  /** 归一化后的词本身（大小写已统一）。 */
  word: string;
  /** 该词在本场弹幕中出现的次数。 */
  count: number;
}

/** 分词 / 词频统计的选项。 */
export interface ExtractWordsOptions {
  /** 覆盖内置停用词表；传入后**不再**使用 `DEFAULT_STOP_WORDS`。 */
  stopWords?: readonly string[];
  /** 覆盖内置噪音词表；传入后**不再**使用 `DEFAULT_NOISE_WORDS`。 */
  noiseWords?: readonly string[];
  /** 叠加在默认值之上的额外停用词（如主播名、直播标题关键词）。 */
  extraStopWords?: readonly string[];
  /** 叠加在默认值之上的额外噪音词（如礼物口令）。 */
  extraNoiseWords?: readonly string[];
  /** 词的最小长度（按 Unicode 码点计），默认 2，小于该长度的词会被丢弃。 */
  minLength?: number;
  /** 只返回词频最高的前 N 个词，不传或 `<= 0` 表示不限。 */
  topN?: number;
}

/** 一条待统计的弹幕消息。 */
export interface DanmuMessageLike {
  /** 发送者 ID（字符串形式，便于与存储层一致）。 */
  userId: string;
  /** 发送者昵称。 */
  username: string;
  /** 弹幕原文。 */
  content: string;
}

/** 一次场次统计的输入。 */
export interface DanmuSessionInput {
  /** 主播名。 */
  streamer: string;
  /** 直播间 ID。 */
  roomId: number;
  /** 开播时间（Date 或可被 `Date.parse` 解析的字符串）。 */
  startedAt: Date | string;
  /** 下播时间（Date 或可被 `Date.parse` 解析的字符串）。 */
  endedAt: Date | string;
  /** 本场记录到的全部弹幕。 */
  messages: readonly DanmuMessageLike[];
}

/** 弹幕王：本场发言最多的人。 */
export interface TopChater {
  userId: string;
  username: string;
  count: number;
}

/** 被重复发送最多的一条弹幕内容。 */
export interface TopRepeated {
  content: string;
  count: number;
}

/** 一场直播的弹幕统计结果。 */
export interface DanmuSessionSummary {
  streamer: string;
  roomId: number;
  /** 开播时间（ISO 字符串）。 */
  startedAt: string;
  /** 下播时间（ISO 字符串）。 */
  endedAt: string;
  /** 直播时长（ms），下播早于开播时按 0 处理。 */
  durationMs: number;
  /** 已格式化的中文时长，如 “1 小时 2 分钟”（来自 `@nana/utils` 的 `formatDuration`）。 */
  durationText: string;
  /** 弹幕总条数。 */
  messageCount: number;
  /** 参与发言的人数。 */
  participantCount: number;
  /** 词频 Top N（默认 10 条）。 */
  topWords: WordCount[];
  /** 弹幕王，无弹幕时为 `null`。 */
  topChater: TopChater | null;
  /** 最高频单条弹幕，无弹幕时为 `null`。 */
  topRepeated: TopRepeated | null;
}

/** 生成场次统计的选项。 */
export interface SummarizeSessionOptions {
  /** Top 词的数量，默认 10。 */
  topWords?: number;
  /** 分词选项，透传给 `extractWords`。 */
  words?: ExtractWordsOptions;
}

/** 词云渲染选项。 */
export interface WordCloudRenderOptions {
  /** 画布宽度，默认 1000。 */
  width?: number;
  /** 画布高度，默认 620。 */
  height?: number;
  /** 最多绘制多少个词，默认 60。 */
  maxWords?: number;
  /** 背景色，默认深色 `#16181d`。 */
  background?: string;
  /** 最大字号（对应词频最高的词），默认 84。 */
  maxFontSize?: number;
  /** 最小字号，默认 14。 */
  minFontSize?: number;
  /** 布局随机种子，固定后同一输入产出完全相同的 SVG，默认 1。 */
  seed?: number;
  /** 画布上的标题文字，默认不显示。 */
  title?: string;
  /**
   * 系统可用中文字体的 CSS font-family 列表（仅影响 SVG 中的 `font-family` 声明），
   * 默认按常见中文黑体回退。
   */
  fontFamily?: readonly string[];
}

/** 渲染 PNG 的选项。 */
export interface RenderPngOptions {
  /** 指定字体文件路径（.ttf/.otf/.ttc），用于系统缺少中文字体时兜底。 */
  fontPath?: string;
  /** 输出像素密度，默认 1。 */
  pixelDensity?: number;
}

/** 场次消息渲染选项。 */
export interface SessionMessageOptions {
  /** 消息标题中的前缀，默认 “弹幕词云”。 */
  title?: string;
  /** 文案中展示的 Top 词数量，默认 10。 */
  topWords?: number;
}
