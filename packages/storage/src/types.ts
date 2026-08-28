import type { PushLogPurpose } from "@nana/constants";

export type StorageValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
export type StoragePath = string | readonly (string | number)[];

export interface StorageOptions {
  rootDir?: string;
}

export interface LiveStatus {
  streamer: string;
  live: boolean;
  updatedAt: string;
  /** 直播间标题（未开播或无记录时为空）。 */
  title?: string | null;
  /** 直播分区名（如“游戏 / 原神”）。 */
  area?: string | null;
  /** 当前直播间人气/观众数。 */
  viewer?: number | null;
}

export type { PushLogPurpose };

/** 一条推送记录。 */
export interface PushLog {
  /** 推送目标的群 ID（字符串形式，便于与 SQLite 一致）。 */
  targetId: string;
  /** 推送目标的可读名称，通常是群昵称。 */
  target: string;
  /** 推送目的（稳定标识）。 */
  purpose: PushLogPurpose;
  /** 推送目的的中文展示名（如 开播 / 上线 / 下线）。 */
  purposeLabel: string;
  /** 推送发生时间（ISO 字符串）。 */
  pushedAt: string;
  /** 是否推送成功。 */
  success: boolean;
  /** 失败时的错误信息。 */
  error?: string | null;
  /** 推送内容的摘要，用于前端时间轴展示。 */
  content?: string | null;
  /** 推送主体（如主播名），用于前端头像/文案展示。 */
  subject?: string | null;
}
