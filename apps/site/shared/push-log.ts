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

/** 活动内按目标群聚合后的推送结果。 */
export interface PushActivityTarget {
  targetId: string;
  target: string;
  success: boolean;
  error: string | null;
  pushedAt: string;
}

/** 一次直播（或一条无法归并的推送）在界面上展示成的活动。 */
export interface PushActivity {
  /** 稳定 key：`${subject}#${该活动最早一条原始记录的 id}`。 */
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
  /** 合并前的原始记录条数：successCount + failureCount。 */
  successCount: number;
  failureCount: number;
  /** 合并前保留的全部原始推送记录，展示合并不丢失原始数据。 */
  items: PushLogItem[];
}

export interface PushLogResponse {
  /** 原始推送记录，按推送时间倒序。 */
  logs: PushLogItem[];
  /** 合并后的推送活动，按最新推送时间倒序。 */
  activities: PushActivity[];
  /** 原始记录窗口被截断（更早的记录未读取，最旧的活动已丢弃）。 */
  truncated: boolean;
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
