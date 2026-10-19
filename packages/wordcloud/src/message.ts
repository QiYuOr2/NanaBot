import { dateFormat } from "@nana/utils";
import type { DanmuSessionSummary, SessionMessageOptions } from "./types.ts";

/** 没有记录到弹幕时的说明文案（推送给管理员，不发图）。 */
export const EMPTY_SESSION_TEXT = "本场没有记录到弹幕。";

/** 时间戳按 `@nana/utils` 的 `dateFormat` 展示（本地时区）。 */
function formatTime(iso: string): string {
  return dateFormat(Date.parse(iso));
}

/**
 * 把一段可能很长的文本压成一行摘要，超出 `maxLength` 时截断并加省略号。
 *
 * 用 `Intl.Segmenter` 按字素切分，避免把 emoji 等复合字符劈成两半。
 */
function clip(text: string, maxLength: number): string {
  const segments = [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)];
  if (segments.length <= maxLength) {
    return text;
  }
  return `${segments
    .slice(0, maxLength)
    .map((segment) => segment.segment)
    .join("")}…`;
}

/**
 * 把场次统计渲染成推送文案。
 *
 * 返回值结构与 `@nana/notify` 的 `NotifyMessage`（`{ subject, text }`）兼容，
 * 可以直接交给任何 `Notifier`。文案覆盖：主播、场次时间、时长、弹幕数、参与人数、
 * Top 词、弹幕王、最高频单条弹幕；本场没有弹幕时只给出 {@link EMPTY_SESSION_TEXT}。
 *
 * @param summary `summarizeSession` 的结果
 * @param options 标题与 Top 词数量
 */
export function renderSessionMessage(
  summary: DanmuSessionSummary,
  options: SessionMessageOptions = {},
): { subject: string; text: string } {
  const title = options.title ?? "弹幕词云";
  const subject = `「NanaBot」${summary.streamer} 本场${title}`;

  if (summary.messageCount === 0) {
    return {
      subject,
      text: [`主播: ${summary.streamer}`, EMPTY_SESSION_TEXT].join("\n"),
    };
  }

  const topWordCount = Math.max(1, options.topWords ?? 10);
  const topWords = summary.topWords.slice(0, topWordCount);
  const lines: string[] = [
    `主播: ${summary.streamer}`,
    `直播间: ${summary.roomId}`,
    `开播: ${formatTime(summary.startedAt)}`,
    `下播: ${formatTime(summary.endedAt)}`,
    `时长: ${summary.durationText}`,
    `弹幕数: ${summary.messageCount}`,
    `参与人数: ${summary.participantCount}`,
    `Top 词: ${topWords.length > 0 ? topWords.map((item) => item.word).join("、") : "（无）"}`,
    `弹幕王: ${summary.topChater ? `${summary.topChater.username}（${summary.topChater.count} 条）` : "（无）"}`,
    `最高频弹幕: ${
      summary.topRepeated
        ? `「${clip(summary.topRepeated.content, 40)}」× ${summary.topRepeated.count}`
        : "（无）"
    }`,
  ];

  return { subject, text: lines.join("\n") };
}
