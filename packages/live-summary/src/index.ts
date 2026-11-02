/**
 * @nana/live-summary
 *
 * 根据一场已入库的弹幕生成直播摘要。只做摘录、提示词、模型调用和落库认领，
 * 不碰 NapCat，也不决定把文字发到哪个群。
 */

export {
  requestDeepSeekChat,
  DeepSeekError,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  DEEPSEEK_SUMMARY_MODEL,
} from "./deepseek.ts";
export type { ChatMessage } from "./deepseek.ts";
export { buildDanmuExcerpt } from "./excerpt.ts";
export type { DanmuExcerpt, SummaryMessage } from "./excerpt.ts";
export { generateLiveSummary, settleLiveSummary } from "./generate.ts";
export type {
  GenerateLiveSummaryInput,
  GeneratedLiveSummary,
  SettleLiveSummaryOptions,
  SettleLiveSummaryResult,
} from "./generate.ts";
export { buildSummaryPrompt } from "./prompt.ts";
export {
  LIVE_SUMMARY_DISCLAIMER,
  LIVE_SUMMARY_MAX_CHARS,
  LIVE_SUMMARY_MIN_CHARS,
  normalizeSummaryText,
  renderLiveSummaryMessage,
} from "./summaryText.ts";
