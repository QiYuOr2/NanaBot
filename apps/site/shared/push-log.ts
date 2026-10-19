import type { PushLogPurpose, PushLogRecord } from "@nana/storage";

/** 推送活动时间轴上的一条原始推送记录（服务端接口返回的 DTO）。 */
export interface PushLogItem {
  id: number;
  /** 推送目标群 ID（字符串）。 */
  targetId: string;
  /** 推送目标可读名称（群昵称）。 */
  target: string;
  purpose: PushLogPurpose;
  purposeLabel: string;
  pushedAt: string;
  success: boolean;
  error: string | null;
  content: string | null;
  subject: string | null;
}

/**
 * 单个目标群的送达状态。
 *
 * - `delivered`：最后一次推送成功；
 * - `failed`：最后一次推送失败，且已超过确认窗口，判定为真的没送达；
 * - `pending`：最后一次推送失败但还在确认窗口内 —— 可能是重复推送 / 回执较慢，展示上不判死刑。
 */
export type PushTargetStatus = "delivered" | "failed" | "pending";

/** 活动内按目标群聚合后的推送结果（以该群最新一次推送为准）。 */
export interface PushActivityTarget {
  targetId: string;
  target: string;
  success: boolean;
  error: string | null;
  pushedAt: string;
  /** 该群在本次活动里的推送总次数。 */
  attemptCount: number;
  /** 其中失败的次数；失败后重试成功时 `attemptCount > 1 && success === true`。 */
  failedAttemptCount: number;
  /** 该群最新一次推送的展示状态。 */
  status: PushTargetStatus;
}

/** 一次直播（或一条无法归并的推送）在界面上展示成的活动。 */
export interface PushActivity {
  /** 稳定 key：`${subject ?? "admin"}#${该活动最早一条原始记录的 id}`。 */
  id: string;
  /** 主播名；无法归并的推送（如管理员失败通知）为 null。 */
  subject: string | null;
  purpose: PushLogPurpose;
  purposeLabel: string;
  /** 该活动最早 / 最新一条推送时间（ISO 字符串）。 */
  startedAt: string;
  latestAt: string;
  /** 该活动内最新的非空内容摘要。 */
  content: string | null;
  /** 按目标群聚合的结果，同一个群重复推送时保留最新一条。 */
  targets: PushActivityTarget[];
  /** 活动覆盖的群数量：`targets.length`。 */
  targetCount: number;
  /** 最终送达的群数（以每个群最后一次推送为准）。 */
  successCount: number;
  /** 最终仍失败的群数；`failureCount + pendingTargetCount + successCount === targetCount`。 */
  failureCount: number;
  /** 最后一次失败但仍可能在确认窗口内的群数。 */
  pendingTargetCount: number;
  /** 发生过重试（推送次数 > 1）的群数。 */
  retryCount: number;
  /** 合并前保留的全部原始推送记录，展示合并不丢失原始数据。 */
  items: PushLogItem[];
}

/** 推送活动列表的汇总口径，用于面板 / 页面顶部摘要。 */
export interface PushActivitySummary {
  activityCount: number;
  /** 全部目标群都送达的活动数。 */
  deliveredActivityCount: number;
  /** 至少一个群最终失败的过滤后活动数。 */
  failedActivityCount: number;
  /** 至少一个群仍处于待确认状态、且没有最终失败的活动数。 */
  pendingActivityCount: number;
  /** 跨活动去重后的失败群数。 */
  failedTargetCount: number;
  /** 跨活动去重后的待确认群数。 */
  pendingTargetCount: number;
}

/** 失败明细：一个群在某条活动里最终没送达。 */
export interface PushActivityFailure {
  activityId: string;
  subject: string | null;
  purpose: PushLogPurpose;
  purposeLabel: string;
  /** 该活动的最新推送时间，用于展示「哪场直播 / 哪次通知」。 */
  activityAt: string;
  targetId: string;
  target: string;
  error: string | null;
  pushedAt: string;
  status: Extract<PushTargetStatus, "failed" | "pending">;
  attemptCount: number;
}

export interface PushLogResponse {
  /** 原始推送记录，按推送时间倒序。 */
  logs: PushLogItem[];
  /** 合并后的推送活动，按最新推送时间倒序。 */
  activities: PushActivity[];
  /** 原始记录窗口被截断（更早的记录未读取，最旧的活动已丢弃）。 */
  truncated: boolean;
  /** 接口生成时间，用于展示「x 秒前」。 */
  generatedAt: string;
}

/** 把存储层的推送记录映射成接口 DTO。 */
export function toPushLogItem(log: PushLogRecord): PushLogItem {
  return {
    id: log.id,
    targetId: log.targetId,
    target: log.target,
    purpose: log.purpose,
    purposeLabel: log.purposeLabel,
    pushedAt: log.pushedAt,
    success: log.success,
    error: log.error ?? null,
    content: log.content ?? null,
    subject: log.subject ?? null,
  };
}
