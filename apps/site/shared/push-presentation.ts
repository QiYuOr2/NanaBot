import type { PushActivity, PushActivityTarget, PushTargetStatus } from "./push-log.ts";

/** 送达状态对应的展示文案（活动级 / 目标群级共用一套口径）。 */
export const PUSH_STATUS_LABELS: Record<PushTargetStatus, string> = {
  delivered: "已送达",
  pending: "待确认",
  failed: "未送达",
};

/** 状态对应的颜色语义，组件据此挑 UnoCSS class，避免各处各写一遍。 */
export type PushStatusTone = "success" | "warning" | "danger";

export const PUSH_STATUS_TONES: Record<PushTargetStatus, PushStatusTone> = {
  delivered: "success",
  pending: "warning",
  failed: "danger",
};

/** 状态徽标用到的背景 / 文字 class（与 `presetVercel` 的色板一致）。 */
export const PUSH_STATUS_CHIP_CLASS: Record<PushStatusTone, string> = {
  success: "bg-live/10 text-live",
  warning: "bg-status-orange/10 text-status-orange",
  danger: "bg-status-red/10 text-status-red",
};

/** 时间轴圆点用的纯色 class。 */
export const PUSH_STATUS_DOT_CLASS: Record<PushStatusTone, string> = {
  success: "bg-live",
  warning: "bg-status-orange",
  danger: "bg-status-red",
};

export interface PushActivityStatusView {
  tone: PushStatusTone;
  /** 徽标文案，例如「已送达」「2/6 未送达」「待确认」。 */
  label: string;
  /** 是否发生过重试后送达（要在徽标旁标注「重试后送达」，避免误以为一次成功）。 */
  retried: boolean;
  /** 悬停提示：列出每个失败 / 待确认群的错误。 */
  title: string;
}

/** 单个目标群的展示状态。 */
export function getTargetStatusView(target: PushActivityTarget): {
  label: string;
  tone: PushStatusTone;
  /** 该群推送过多次（失败 → 重试），需要额外说明。 */
  retried: boolean;
  /** 描述本次结果的一句话，例如「第 2 次推送送达（首次：ws 未连接）」。 */
  detail: string;
} {
  const tone = PUSH_STATUS_TONES[target.status];
  const retried = target.attemptCount > 1;

  let detail = PUSH_STATUS_LABELS[target.status];
  if (retried) {
    detail =
      target.status === "delivered"
        ? `重试 ${target.attemptCount} 次后送达（曾失败 ${target.failedAttemptCount} 次）`
        : `已推送 ${target.attemptCount} 次，仍${PUSH_STATUS_LABELS[target.status]}`;
  }

  return {
    label: PUSH_STATUS_LABELS[target.status],
    tone,
    retried,
    detail: target.error ? `${detail}：${target.error}` : detail,
  };
}

/**
 * 活动的展示状态。
 *
 * 口径与 `buildPushActivities` 一致：成败只看「每个群最终有没有送达」，
 * 所以不会出现徽标写着「已送达」、右边又挂「2 失败」的自相矛盾。
 */
export function getActivityStatusView(
  activity: Pick<
    PushActivity,
    | "targets"
    | "targetCount"
    | "successCount"
    | "failureCount"
    | "pendingTargetCount"
    | "retryCount"
  >,
): PushActivityStatusView {
  const { targetCount, successCount, failureCount, pendingTargetCount, retryCount } = activity;

  const tone: PushStatusTone =
    failureCount > 0 ? "danger" : pendingTargetCount > 0 ? "warning" : "success";

  let label = PUSH_STATUS_LABELS.delivered;
  if (targetCount > 1) {
    if (tone === "success") {
      label = `${targetCount} 群全部送达`;
    } else if (tone === "danger") {
      label = `${failureCount}/${targetCount} 群未送达`;
    } else {
      label = `${pendingTargetCount}/${targetCount} 群待确认`;
    }
  } else if (tone === "danger") {
    label = PUSH_STATUS_LABELS.failed;
  } else if (tone === "warning") {
    label = PUSH_STATUS_LABELS.pending;
  }

  const title = activity.targets
    .filter((target) => target.status !== "delivered")
    .map((target) => `${target.target}：${getTargetStatusView(target).detail}`)
    .join("\n");

  return {
    tone,
    label,
    retried: retryCount > 0 && tone === "success",
    // 全部送达但有重试时，也把「哪些群重试过」告诉用户。
    title:
      title ||
      (retryCount > 0
        ? `${successCount} 个群送达，其中 ${retryCount} 个群重试后送达`
        : `${targetCount} 个群全部送达`),
  };
}

export interface PushActivityDayGroup<T> {
  /** 本地日期键（YYYY-MM-DD），时间非法时为原始字符串。 */
  key: string;
  /** 分组标题：今天 / 昨天 / M月d日 周X。 */
  label: string;
  items: T[];
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 把已按时间倒序排列的活动按本地日期分组，保持原顺序。
 * 长列表里只有相对时间（「3 小时前」）很难定位某一天的推送，分组标题补上日期锚点。
 */
export function groupActivitiesByDay<T extends { latestAt: string }>(
  activities: readonly T[],
  now: Date = new Date(),
): PushActivityDayGroup<T>[] {
  const todayKey = localDayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday);

  const groups: PushActivityDayGroup<T>[] = [];
  for (const activity of activities) {
    const date = new Date(activity.latestAt);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? localDayKey(date) : activity.latestAt;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(activity);
      continue;
    }
    let label = key;
    if (valid) {
      if (key === todayKey) {
        label = "今天";
      } else if (key === yesterdayKey) {
        label = "昨天";
      } else {
        label = `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
      }
    }
    groups.push({ key, label, items: [activity] });
  }
  return groups;
}

/** 目标群摘要：单个群直接展示昵称，多个群展示数量与昵称列表。 */
export function summarizeTargets(activity: PushActivity, maxNames = 3): string {
  const targets = activity.targets;
  if (targets.length === 1) {
    return targets[0]?.target ?? "—";
  }

  const names = targets
    .slice(0, maxNames)
    .map((item) => item.target)
    .join("、");
  const rest = targets.length - maxNames;
  return rest > 0 ? `${names} 等 ${targets.length} 个群` : names;
}
