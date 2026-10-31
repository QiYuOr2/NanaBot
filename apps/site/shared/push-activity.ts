import type {
  PushActivity,
  PushActivityFailure,
  PushActivitySummary,
  PushActivityTarget,
  PushLogItem,
  PushTargetStatus,
} from "./push-log.ts";

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

/**
 * 同一次任务里连续发出的消息，相邻间隔不超过该值就并成一条活动。
 *
 * 启动时会紧挨着写两条「上线」：NapCat 连上后的「我来了~」，以及直播间长连接
 * 打开后的回执。它们不是两件事，但中间可能隔着一次握手，所以窗口取 1 分钟，
 * 而不是毫秒。超过这个间隔的下一次上线 / 通知仍各自成条。
 */
export const PUSH_BURST_GAP_MS = 60 * 1000;

/**
 * 失败的推送在多久之内只标记为「待确认」而不是「失败」。
 *
 * 群里看到消息但推送记录显示失败时，多半是重复推送 / 回执慢；留一分钟观察窗口，
 * 超过窗口仍未收到成功记录才判定为真的没送达。
 */
export const PUSH_PENDING_WINDOW_MS = 60 * 1000;

/**
 * 需要按场次合并、并做送达统计的推送目的。
 *
 * 直播开播 / 下播通知会同时推到多个群，才是「哪个群没收到」需要排查的场景；
 * 机器人上线、离线、管理员通知、词云这类单目标推送的成败由它们自己承担，
 * 既不代表某场直播失败，也不应该把相邻的失败记录一起算进汇总。
 */
export const aggregatablePurposes: ReadonlySet<PushActivity["purpose"]> = new Set([
  "live.start",
  "live.end",
]);

export interface BuildPushActivitiesOptions {
  /** 覆盖默认的「同一次直播」时间间隔阈值，便于测试或按需调整。 */
  sessionGapMs?: number;
  /** 覆盖「同一次任务的连续消息」时间间隔阈值。 */
  burstGapMs?: number;
  /** 覆盖「失败 → 待确认」的观察窗口。 */
  pendingWindowMs?: number;
  /** 判定待确认状态用的当前时间，缺省为构建时刻。 */
  now?: Date | string | number;
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

function resolveNow(now: BuildPushActivitiesOptions["now"]): number {
  if (now === undefined) {
    return Date.now();
  }
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

/** 渲染用的空串归一：`undefined` / 空串都当「没有主播名」。 */
function normalizeSubject(subject: string | null | undefined): string | null {
  const trimmed = subject?.trim();
  return trimmed ? trimmed : null;
}

/** 单条记录的送达状态。时间无法解析时按「已过窗口」处理，宁可报失败也不要吞掉真实故障。 */
function statusOf(item: PushLogItem, pendingWindowMs: number, now: number): PushTargetStatus {
  if (item.success) {
    return "delivered";
  }

  const age = now - toTime(item.pushedAt);
  return Number.isFinite(age) && age < pendingWindowMs ? "pending" : "failed";
}

/** 同一次任务里的不同消息：有一条没送达，整群就不算送达。 */
function preferStatus(current: PushTargetStatus, incoming: PushTargetStatus): PushTargetStatus {
  const rank: Record<PushTargetStatus, number> = { delivered: 0, pending: 1, failed: 2 };
  return rank[incoming] > rank[current] ? incoming : current;
}

interface TargetBucket {
  /** 最近一条消息的文案。文案相同才算重试，不同则是同一次任务里的另一条消息。 */
  content: string | null;
  target: PushActivityTarget;
}

/**
 * 按目标群聚合。
 *
 * 同一个群、同一文案的后一条是重试：保留最新结果，并用推送次数区分
 * 「重试后送达」与「真的失败」。文案不同则是同一次任务里连着发出的另一条消息，
 * 不记成重试；只要其中一条没送达，该群就不算送达。
 */
function collectTargets(
  items: PushLogItem[],
  pendingWindowMs: number,
  now: number,
): PushActivityTarget[] {
  const byTarget = new Map<string, TargetBucket>();

  for (const item of items) {
    const content = item.content ?? null;
    const incoming = statusOf(item, pendingWindowMs, now);
    const previous = byTarget.get(item.targetId);

    if (!previous) {
      byTarget.set(item.targetId, {
        content,
        target: {
          targetId: item.targetId,
          target: item.target,
          success: item.success,
          error: item.error,
          pushedAt: item.pushedAt,
          attemptCount: 1,
          failedAttemptCount: item.success ? 0 : 1,
          status: incoming,
        },
      });
      continue;
    }

    if (previous.content === content) {
      previous.target = {
        ...previous.target,
        target: item.target,
        success: item.success,
        error: item.error,
        pushedAt: item.pushedAt,
        attemptCount: previous.target.attemptCount + 1,
        failedAttemptCount: previous.target.failedAttemptCount + (item.success ? 0 : 1),
        status: incoming,
      };
      continue;
    }

    const status = preferStatus(previous.target.status, incoming);
    previous.content = content;
    previous.target = {
      ...previous.target,
      target: item.target,
      success: status === "delivered",
      error:
        status === "delivered"
          ? null
          : incoming === "delivered"
            ? previous.target.error
            : item.error,
      pushedAt: item.pushedAt,
      attemptCount: 1,
      failedAttemptCount: incoming === "delivered" ? 0 : 1,
      status,
    };
  }

  return [...byTarget.values()].map((bucket) => bucket.target);
}

/** 把一组原始记录收成一条展示活动；失败计数一律以「每个群的最终状态」为准。 */
function toActivity(source: PushLogItem[], pendingWindowMs: number, now: number): PushActivity {
  const items = [...source].sort(compareAsc);
  const first = items[0];
  if (!first) {
    throw new Error("推送活动至少需要一条推送记录。");
  }

  const latest = items.at(-1) ?? first;
  // 活动标题取开播记录的类型；无法归并的推送用自身的 purpose。
  const titled = items.find((item) => item.purpose === "live.start") ?? first;
  const targets = collectTargets(items, pendingWindowMs, now);

  // 成败一律按「每个群的最终状态」统计：重试后送达的群算成功，不会因为
  // 历史里有失败记录就把整条活动标红。
  let successCount = 0;
  let failureCount = 0;
  let pendingTargetCount = 0;
  let retryCount = 0;

  for (const target of targets) {
    if (target.status === "delivered") {
      successCount += 1;
    } else if (target.status === "pending") {
      pendingTargetCount += 1;
    } else {
      failureCount += 1;
    }

    if (target.attemptCount > 1) {
      retryCount += 1;
    }
  }

  return {
    id: `${normalizeSubject(first.subject) ?? "admin"}#${first.id}`,
    subject: normalizeSubject(first.subject),
    purpose: titled.purpose,
    purposeLabel: titled.purposeLabel,
    startedAt: first.pushedAt,
    latestAt: latest.pushedAt,
    content: activityContent(items),
    targets,
    targetCount: targets.length,
    successCount,
    failureCount,
    pendingTargetCount,
    retryCount,
    items,
  };
}

/**
 * 活动摘要。同一目的里不同文案按时间拼在一起（启动时的「我来了~」和连接回执）；
 * 开播和下播文案不同，仍只留最新一条，避免一张「开播」卡片同时挂上下播文案。
 */
function activityContent(items: PushLogItem[]): string | null {
  const first = items[0];
  if (!first || !items.every((item) => item.purpose === first.purpose)) {
    return items.findLast((item) => item.content)?.content ?? null;
  }

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const item of items) {
    const text = item.content?.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    parts.push(text);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function isAggregatable(log: PushLogItem): boolean {
  return aggregatablePurposes.has(log.purpose) && normalizeSubject(log.subject) !== null;
}

/** 按时间升序切段：相邻两条间隔超过 `gapMs` 就另起一段。 */
function splitByGap(logs: PushLogItem[], gapMs: number): PushLogItem[][] {
  const groups: PushLogItem[][] = [];
  let current: PushLogItem[] = [];
  let previousTime = Number.NaN;

  for (const log of [...logs].sort(compareAsc)) {
    const time = toTime(log.pushedAt);
    const nextGroup =
      current.length > 0 &&
      Number.isFinite(previousTime) &&
      Number.isFinite(time) &&
      time - previousTime > gapMs;

    if (nextGroup) {
      groups.push(current);
      current = [];
    }

    current.push(log);
    previousTime = time;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

/** 连续消息的归并键：同目的、同主体才可能是同一次任务。不同目的即使间隔几毫秒也不并。 */
function burstKey(log: PushLogItem): string {
  return `${log.purpose}\0${normalizeSubject(log.subject) ?? ""}`;
}

/**
 * 把原始推送记录合并成展示用的推送活动。
 *
 * 推送记录里没有直播场次字段，因此按「主播名（`subject`）+ 相邻推送间隔」推断
 * 同一次直播：同一主播、间隔不超过 `sessionGapMs` 的连续开播 / 下播记录属于同一场直播。
 *
 * 只有 `aggregatablePurposes` 里、且带主播名的记录参与场次合并（见 `isAggregatable`）。
 * 其余记录不进场次，但同目的、同主体、间隔不超过 `burstGapMs` 的连续消息并成一条：
 * 启动时的「我来了~」和直播间连接回执就是这样。不同目的（上线旁边的失败通知）
 * 仍然分开，避免把正常上线算成一条失败活动。
 *
 * 合并只影响展示，`items` 里保留全部原始记录。
 */
export function buildPushActivities(
  logs: PushLogItem[],
  options: BuildPushActivitiesOptions = {},
): PushActivity[] {
  const sessionGapMs = options.sessionGapMs ?? PUSH_SESSION_GAP_MS;
  const burstGapMs = options.burstGapMs ?? PUSH_BURST_GAP_MS;
  const pendingWindowMs = options.pendingWindowMs ?? PUSH_PENDING_WINDOW_MS;
  const now = resolveNow(options.now);
  const bySubject = new Map<string, PushLogItem[]>();
  const standalone: PushLogItem[] = [];

  for (const log of logs) {
    if (!isAggregatable(log)) {
      standalone.push(log);
      continue;
    }

    const subject = normalizeSubject(log.subject) as string;
    const items = bySubject.get(subject);
    if (items) {
      items.push(log);
    } else {
      bySubject.set(subject, [log]);
    }
  }

  const activities: PushActivity[] = [];

  for (const subjectLogs of bySubject.values()) {
    for (const session of splitByGap(subjectLogs, sessionGapMs)) {
      activities.push(toActivity(session, pendingWindowMs, now));
    }
  }

  const byBurst = new Map<string, PushLogItem[]>();
  for (const log of standalone) {
    const key = burstKey(log);
    const items = byBurst.get(key);
    if (items) {
      items.push(log);
    } else {
      byBurst.set(key, [log]);
    }
  }

  for (const burstLogs of byBurst.values()) {
    for (const burst of splitByGap(burstLogs, burstGapMs)) {
      activities.push(toActivity(burst, pendingWindowMs, now));
    }
  }

  return activities.sort((a, b) => {
    const diff = toTime(b.latestAt) - toTime(a.latestAt);
    if (Number.isNaN(diff) || diff === 0) {
      return (b.items[0]?.id ?? 0) - (a.items[0]?.id ?? 0);
    }
    return diff;
  });
}

/** 活动的展示口径：全部送达 / 仍有群待确认 / 有群最终失败。 */
export type PushActivityTone = "delivered" | "pending" | "failed";

/**
 * 一条活动的展示口径。
 *
 * 有群最终失败时永远不会显示成「已送达」；只有待确认（失败后还没过观察窗口）的群
 * 单独标成 `pending`，避免「已送达」和「2 失败」同时出现这种自相矛盾的展示。
 */
export function getPushActivityTone(
  activity: Pick<PushActivity, "failureCount" | "pendingTargetCount">,
): PushActivityTone {
  if (activity.failureCount > 0) {
    return "failed";
  }
  return activity.pendingTargetCount > 0 ? "pending" : "delivered";
}

/** 汇总口径：失败按群去重，跨活动统计。 */
export function summarizePushActivities(activities: readonly PushActivity[]): PushActivitySummary {
  const failedTargets = new Set<string>();
  const pendingTargets = new Set<string>();
  let delivered = 0;
  let failed = 0;
  let pending = 0;

  for (const activity of activities) {
    if (activity.failureCount > 0) {
      failed += 1;
    } else if (activity.pendingTargetCount > 0) {
      pending += 1;
    } else {
      delivered += 1;
    }

    for (const target of activity.targets) {
      if (target.status === "failed") {
        failedTargets.add(target.targetId);
      } else if (target.status === "pending") {
        pendingTargets.add(target.targetId);
      }
    }
  }

  return {
    activityCount: activities.length,
    deliveredActivityCount: delivered,
    failedActivityCount: failed,
    pendingActivityCount: pending,
    failedTargetCount: failedTargets.size,
    pendingTargetCount: pendingTargets.size,
  };
}

/** 收集最终没送达的目标群，按最新推送时间倒序；同一群只保留最近一次失败。 */
export function collectPushActivityFailures(
  activities: readonly PushActivity[],
): PushActivityFailure[] {
  const failures: PushActivityFailure[] = [];

  for (const activity of activities) {
    for (const target of activity.targets) {
      if (target.status === "delivered") {
        continue;
      }

      failures.push({
        activityId: activity.id,
        subject: activity.subject,
        purpose: activity.purpose,
        purposeLabel: activity.purposeLabel,
        activityAt: activity.latestAt,
        targetId: target.targetId,
        target: target.target,
        error: target.error,
        pushedAt: target.pushedAt,
        status: target.status,
        attemptCount: target.attemptCount,
      });
    }
  }

  return failures.sort((a, b) => toTime(b.pushedAt) - toTime(a.pushedAt));
}
