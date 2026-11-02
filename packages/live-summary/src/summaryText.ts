import { LIVE_SUMMARY_DISCLAIMER } from "@nana/constants";

/** 摘要正文的字数上限。按 Unicode 码位计，避免把一个汉字切成半个。 */
export const LIVE_SUMMARY_MAX_CHARS = 200;

/** 提示词要求的下限。短于该值仍会保存，避免把可用的短摘要判成失败。 */
export const LIVE_SUMMARY_MIN_CHARS = 50;

export { LIVE_SUMMARY_DISCLAIMER };

/** 去掉模型额外加上的引号、标题和空白，并截到上限。 */
export function normalizeSummaryText(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^(?:直播摘要|摘要)\s*[:：]\s*/u, "");
  text = text.replace(/^["「『]|["」』]$/gu, "").trim();
  text = text.replace(/\s+/gu, (chunk) => (chunk.includes("\n") ? "\n" : " "));

  const chars = Array.from(text);
  if (chars.length <= LIVE_SUMMARY_MAX_CHARS) {
    return chars.join("").trim();
  }

  const cut = chars.slice(0, LIVE_SUMMARY_MAX_CHARS).join("");
  const punctuation = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
  if (punctuation >= LIVE_SUMMARY_MIN_CHARS) {
    return cut.slice(0, punctuation + 1);
  }
  return cut;
}

/** 发到通知群的整段文字。页面另行展示同一句说明和同一份正文。 */
export function renderLiveSummaryMessage(text: string): string {
  return `【直播摘要】${LIVE_SUMMARY_DISCLAIMER}\n${text}`;
}
