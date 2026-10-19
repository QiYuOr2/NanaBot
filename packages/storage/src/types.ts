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

/** 场次的结束原因：下播事件 / 轮询兜底 / 进程退出 / 开新场时清理的残留场次。 */
export type DanmuSessionCloseReason = "live.ended" | "poll" | "shutdown" | "stale";

/**
 * 一场弹幕记录（对应 `danmu_session` 表的一行）。
 *
 * 时间均为 ISO 字符串，与库中 TEXT 列一一对应，便于直接透传给前端。
 */
export interface DanmuSession {
  /** 场次自增 ID。 */
  id: number;
  /** 直播间号（字符串形式，与 SQLite 一致）。 */
  roomId: string;
  /** 主播名。 */
  streamer: string;
  /** 开播时间（ISO 字符串）。 */
  startedAt: string;
  /** 结束时间（ISO 字符串），进行中的场次为 null。 */
  endedAt: string | null;
  /** 结束原因，进行中的场次为 null。 */
  closeReason: DanmuSessionCloseReason | null;
  /** 本场已收录的弹幕条数。 */
  msgCount: number;
}

/** 一条弹幕记录（对应 `danmu_message` 表的一行）。 */
export interface DanmuMessage {
  /** 弹幕自增 ID。 */
  id: number;
  /** 所属场次 ID。 */
  sessionId: number;
  /** 弹幕发送时间（ISO 字符串）。 */
  sentAt: string;
  /** 发送者 UID（字符串形式，与 SQLite 一致）。 */
  userId: string;
  /** 发送者昵称。 */
  username: string;
  /** 弹幕原文。 */
  content: string;
}

/** 写入弹幕时由调用方提供的字段（id 与 sessionId 由存储层填充）。 */
export type DanmuMessageInput = Omit<DanmuMessage, "id" | "sessionId">;

/** 场次及其统计信息，供面板列表展示。 */
export interface DanmuSessionWithStats extends DanmuSession {
  /** 期间参与发言的人数（按 user_id 去重）。 */
  participantCount: number;
}
