import type { PushActivity, PushActivityTarget, PushLogItem } from "./push-log.ts";

/** 面板页最多展示的推送活动条数。 */
export const PUSH_ACTIVITY_PANEL_LIMIT = 5;

/** 原始推送记录的默认读取窗口：一次开播会为每个通知群各写一条记录。 */
export const PUSH_ACTIVITY_RAW_LIMIT = 500;

/** 原始读取窗口的上限，避免通过 query 传入过大的值。 */
export const PUSH_ACTIVITY_RAW_LIMIT_MAX = 2000;

/**
 * 同一主播相邻推送间隔超过该阈值，即视为进入了下一场直播。
 *
 * 同一次开播会向多个群各推一条记录，`pushedAt` 只相差毫秒；两场直播之间通常
 * 相隔数小时，所以 30 分钟足以区分「同一次直播的多次推送」与「两场直播」。
 */
export const PUSH_SESSION_GAP_MS = 30 * 60 * 1000;

export interface BuildPushActivitiesOptions {
  /** 覆盖默认的「同一次直播」时间间隔阈值，便于测试或按需调整。 */
  sessionGapMs?: number;
}

function toTime(iso: string): number {
  return Date.parse(iso);
}

/** 按推送时间升序；时间相同或无法解析时回退到自增 id。 */
function compareAsc(a: PushLogItem, b: PushLogItem): number {
  const diff = toTime(a.pushedAt) - toTime(b.pushedAt);
  if (Number.isNaN(diff) || diff === 0) {
    return a.id - b.id;
  }
  return diff;
}

/** 按目标群聚合，同一个群重复推送时保留最新一条。 */
function collectTargets(items: PushLogItem[]): PushActivityTarget[] {
  const byTarget = new Map<string, PushActivityTarget>();

  for (const item of items) {
    byTarget.set(item.targetId, {
      targetId: item.targetId,
      target: item.target,
      success: item.success,
      error: item.error,
      pushedAt: item.pushedAt,
    });
  }

  return [...byTarget.values()];
}

function toActivity(source: PushLogItem[]): PushActivity {
  const items = [...source].sort(compareAsc);
  const first = items[0];
  if (!first) {
    throw new Error("推送活动至少需要一条推送记录。");
  }

  const latest = items.at(-1) ?? first;
  // 活动标题取开播记录的类型；无法归并的推送用自身的 purpose。
  const titled = items.find((item) => item.purpose === "live.start") ?? first;
  const failureCount = items.filter((item) => !item.success).length;

  return {
    id: `${first.subject ?? "—"}#${first.id}`,
    subject: first.subject,
    purpose: titled.purpose,
    purposeLabel: titled.purposeLabel,
    startedAt: first.pushedAt,
    latestAt: latest.pushedAt,
    content: items.findLast((item) => item.content)?.content ?? null,
    targets: collectTargets(items),
    successCount: items.length - failureCount,
    failureCount,
    items,
  };
}

/**
 * 把原始推送记录合并成展示用的推送活动。
 *
 * 推送记录里没有直播场次字段，因此按「主播名（`subject`）+ 相邻推送间隔」推断
 * 同一次直播：同一主播、间隔不超过 `sessionGapMs` 的连续记录属于同一场直播。
 * `subject` 为空的管理员推送（失败通知、上下线提示）无法归并，各自作为一条活动
 * 保留，避免合并时丢数据。合并只影响展示，`items` 里保留全部原始记录。
 */
export function buildPushActivities(
  logs: PushLogItem[],
  options: BuildPushActivitiesOptions = {},
): PushActivity[] {
  const sessionGapMs = options.sessionGapMs ?? PUSH_SESSION_GAP_MS;
  const bySubject = new Map<string, PushLogItem[]>();
  const standalone: PushLogItem[] = [];

  for (const log of logs) {
    const subject = log.subject?.trim();
    if (!subject) {
      standalone.push(log);
      continue;
    }

    const items = bySubject.get(subject);
    if (items) {
      items.push(log);
    } else {
      bySubject.set(subject, [log]);
    }
  }

  const activities: PushActivity[] = [];

  for (const subjectLogs of bySubject.values()) {
    let session: PushLogItem[] = [];
    let previousTime = Number.NaN;

    for (const log of [...subjectLogs].sort(compareAsc)) {
      const time = toTime(log.pushedAt);
      const nextSession =
        session.length > 0 &&
        Number.isFinite(previousTime) &&
        Number.isFinite(time) &&
        time - previousTime > sessionGapMs;

      if (nextSession) {
        activities.push(toActivity(session));
        session = [];
      }

      session.push(log);
      previousTime = time;
    }

    if (session.length > 0) {
      activities.push(toActivity(session));
    }
  }

  activities.push(...standalone.map((log) => toActivity([log])));

  return activities.sort((a, b) => {
    const diff = toTime(b.latestAt) - toTime(a.latestAt);
    if (Number.isNaN(diff) || diff === 0) {
      return (b.items[0]?.id ?? 0) - (a.items[0]?.id ?? 0);
    }
    return diff;
  });
}
