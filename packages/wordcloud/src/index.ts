/**
 * @nana/wordcloud
 *
 * 弹幕词云领域包：只做「分词 / 统计 / 渲染」这类纯计算，不碰 NapCat、配置与定时器。
 * 事件绑定、配置读取、推送编排都留在 `apps/*`。
 */

export { extractWords } from "./extract.ts";
export {
  DEFAULT_CLOUD_BACKGROUND,
  DEFAULT_CLOUD_FONT_FAMILY,
  DEFAULT_CLOUD_HEIGHT,
  DEFAULT_CLOUD_MAX_WORDS,
  DEFAULT_CLOUD_WIDTH,
  WORDCLOUD_PALETTE,
} from "./layout.ts";
export { EMPTY_SESSION_TEXT, renderSessionMessage } from "./message.ts";
export { renderWordCloudPng } from "./png.ts";
export { summarizeSession } from "./summary.ts";
export { buildWordCloudSvg, escapeXml } from "./svg.ts";
export { DEFAULT_NOISE_WORDS, DEFAULT_STOP_WORDS } from "./words.ts";
export type {
  DanmuMessageLike,
  DanmuSessionInput,
  DanmuSessionSummary,
  ExtractWordsOptions,
  RenderPngOptions,
  SessionMessageOptions,
  SummarizeSessionOptions,
  TopChater,
  TopRepeated,
  WordCloudRenderOptions,
  WordCount,
} from "./types.ts";
