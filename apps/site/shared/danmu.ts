import type { DanmuSessionCloseReason, DanmuSessionWithStats } from "@nana/storage";
import type { DanmuSessionSummary } from "@nana/wordcloud";

/** 列表接口默认返回的场次条数。 */
export const DANMU_SESSION_LIST_LIMIT = 20;

/** 列表接口最多返回的场次条数（`?limit=` 的上限）。 */
export const DANMU_SESSION_LIST_LIMIT_MAX = 100;

/** 列表接口里最多为最近几场计算 Top 词，其余场次 `topWords` 返回空数组。 */
export const DANMU_SESSION_TOP_WORDS_SESSIONS = 10;

/** 列表接口每场返回的 Top 词数量。 */
export const DANMU_SESSION_TOP_WORDS = 10;

/** 详情接口返回的 Top 词数量。 */
export const DANMU_DETAIL_TOP_WORDS = 30;

/** 词云图最多绘制的词数，与 `@nana/wordcloud` 的默认值保持一致。 */
export const DANMU_WORDCLOUD_MAX_WORDS = 60;

/** 详情接口「最近弹幕」的条数上限。 */
export const DANMU_DETAIL_MESSAGE_LIMIT = 200;

/** 结束原因的中文展示名；进行中的场次 `closeReason` 为 null。 */
export const DANMU_CLOSE_REASON_LABELS: Record<DanmuSessionCloseReason, string> = {
  "live.ended": "正常下播",
  poll: "轮询兜底",
  shutdown: "进程退出",
  stale: "残留清理",
};

/** 最终产出格式：PNG 图片（浏览器展示）或 SVG 文本（PNG 渲染失败时的降级）。 */
export type DanmuWordCloudFormat = "png" | "svg";

/** 一个词及其出现次数（与 `@nana/wordcloud` 的 `WordCount` 结构一致）。 */
export interface DanmuWordCountDto {
  word: string;
  count: number;
}

/** 列表里的一场弹幕记录。 */
export interface DanmuSessionSummaryDto {
  id: number;
  streamer: string;
  /** 直播间号；存储层以字符串保存，这里转成数字便于与主播卡片对齐。 */
  roomId: number;
  startedAt: string;
  endedAt: string | null;
  closeReason: DanmuSessionCloseReason | null;
  /** 结束原因的中文展示名；进行中的场次为 null。 */
  closeReasonLabel: string | null;
  /** 直播时长（ms）；进行中的场次按「截至当前」计算。 */
  durationMs: number;
  /** 已格式化的中文时长。 */
  durationText: string;
  msgCount: number;
  participantCount: number;
  /** Top 词；超过 {@link DANMU_SESSION_TOP_WORDS_SESSIONS} 的旧场次为空数组。 */
  topWords: DanmuWordCountDto[];
  /** 该场是否仍在进行中。 */
  active: boolean;
}

/** 详情页展示的一条弹幕。 */
export interface DanmuMessageDto {
  id: number;
  sentAt: string;
  userId: string;
  username: string;
  content: string;
}

/** 详情页的场次统计。 */
export interface DanmuSessionStatsDto {
  messageCount: number;
  participantCount: number;
  durationMs: number;
  durationText: string;
  /** 场均每分钟弹幕数，保留 1 位小数；时长为 0 时为 0。 */
  messagesPerMinute: number;
  topChater: { userId: string; username: string; count: number } | null;
  topRepeated: { content: string; count: number } | null;
}

/** `GET /api/danmu/sessions` 的响应。 */
export interface DanmuSessionsResponse {
  sessions: DanmuSessionSummaryDto[];
  /** 实际生效的条数上限。 */
  limit: number;
}

/** 已保存的直播摘要。`text` 只在 `ok` 时有值，和发到群里的正文是同一段。 */
export interface DanmuLiveSummaryDto {
  status: "ok" | "empty" | "failed" | "pending" | null;
  text: string | null;
}

/** `POST /api/danmu/:id/summary` 的响应。`message` 只在失败时给页面提示。 */
export interface DanmuLiveSummaryResponse {
  summary: DanmuLiveSummaryDto;
  message?: string;
}

/** `GET /api/danmu/:id` 的响应。 */
export interface DanmuSessionDetailResponse {
  session: DanmuSessionSummaryDto;
  stats: DanmuSessionStatsDto;
  /** 本场摘要。还没生成时 `status` 为 null。 */
  liveSummary: DanmuLiveSummaryDto;
  /** Top 词，最多 {@link DANMU_DETAIL_TOP_WORDS} 个。 */
  topWords: DanmuWordCountDto[];
  /** 最近若干条弹幕，按时间倒序（最新在前）。 */
  messages: DanmuMessageDto[];
  /** 详情里这段时间内是否还有更早的弹幕没有返回。 */
  messagesTruncated: boolean;
}

/** 把存储层的场次行映射成列表 DTO；`durationMs` / `durationText` 由调用方按需填充。 */
export function toDanmuSessionSummary(
  session: DanmuSessionWithStats,
  duration: { ms: number; text: string },
  topWords: DanmuWordCountDto[] = [],
): DanmuSessionSummaryDto {
  const roomId = Number(session.roomId);
  return {
    id: session.id,
    streamer: session.streamer,
    roomId: Number.isFinite(roomId) ? roomId : 0,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    closeReason: session.closeReason,
    closeReasonLabel: session.closeReason ? DANMU_CLOSE_REASON_LABELS[session.closeReason] : null,
    durationMs: duration.ms,
    durationText: duration.text,
    msgCount: session.msgCount,
    participantCount: session.participantCount,
    topWords,
    active: session.endedAt === null,
  };
}

/** 把 `summarizeSession` 的结果映射成详情页统计。 */
export function toDanmuSessionStats(summary: DanmuSessionSummary): DanmuSessionStatsDto {
  return {
    messageCount: summary.messageCount,
    participantCount: summary.participantCount,
    durationMs: summary.durationMs,
    durationText: summary.durationText,
    messagesPerMinute: toMessagesPerMinute(summary.messageCount, summary.durationMs),
    topChater: summary.topChater
      ? {
          userId: summary.topChater.userId,
          username: summary.topChater.username,
          count: summary.topChater.count,
        }
      : null,
    topRepeated: summary.topRepeated
      ? { content: summary.topRepeated.content, count: summary.topRepeated.count }
      : null,
  };
}

/** 把 `extractWords` 的结果收敛成 DTO 结构（字段名一致，显式拷贝保证只透传展示字段）。 */
export function toDanmuWordCounts(
  words: readonly { word: string; count: number }[],
): DanmuWordCountDto[] {
  return words.map((item) => ({ word: item.word, count: item.count }));
}

/** 解析 `?limit=`：非法值回退默认，超限按上限截断。 */
export function resolveDanmuSessionLimit(value: unknown): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    return DANMU_SESSION_LIST_LIMIT;
  }
  return Math.min(limit, DANMU_SESSION_LIST_LIMIT_MAX);
}

/** 解析 `?format=`：只接受 `png` / `svg`，其余一律按 PNG 处理。 */
export function resolveDanmuWordCloudFormat(value: unknown): DanmuWordCloudFormat {
  return value === "svg" ? "svg" : "png";
}

/**
 * 词云图中的相对路径。
 *
 * 结果是 `/api/danmu/<id>/wordcloud`（SVG 降级时为 `?format=svg`），会拼进 `<img src>`；
 * `id` 由调用方保证是数字，`format` 走白名单分支，不拼接任何外部输入。
 */
export function danmuWordCloudSrcPath(id: number, format: DanmuWordCloudFormat = "png"): string {
  return `/api/danmu/${id}/wordcloud${format === "svg" ? "?format=svg" : ""}`;
}

/** 每分钟弹幕数，保留 1 位小数。 */
function toMessagesPerMinute(messageCount: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return Math.round((messageCount / (durationMs / 60_000)) * 10) / 10;
}
