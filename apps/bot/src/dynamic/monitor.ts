import type { BilibiliDynamic, BilibiliDynamicType } from "@nana/bilibili-api";
import type { DynamicItemRecord, StorageOptions } from "@nana/storage";
import type { DynamicSubscribeType } from "./config.ts";
import {
  listPendingDynamics,
  markDynamicFailed,
  markDynamicSkipped,
  markDynamicSuccess,
  readDynamicMonitorState,
  recordDiscoveredDynamics,
  touchMonitorCheck,
} from "@nana/storage";
import { formatDynamic, type FormattedDynamic } from "./formatter.ts";
import type { SendResult } from "./sender.ts";

/** 监控日志出口，与 bot Logger 子集兼容。 */
export interface DynamicLogger {
  info(message: string, error?: unknown): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

/** 拉取动态的依赖注入点（生产用 BilibiliDynamicClient，测试用 fake）。 */
export interface DynamicFetcher {
  fetchUserDynamics(uid: number, limit?: number): Promise<BilibiliDynamic[]>;
}

/** 发送依赖注入点（生产用 sendDynamicToGroups，测试用 fake）。 */
export interface DynamicPusher {
  (formatted: FormattedDynamic, groupIds: readonly number[]): Promise<SendResult>;
}

/** 单个 UP 主的轮询配置（与 config 的 DynamicStreamerConfig 对齐，但不含账号字段）。 */
export interface MonitoredStreamer {
  uid: number;
  streamer: string;
  notifyGroups: number[];
  enableNotify: boolean;
  types: DynamicSubscribeType[];
}

/** 把动态类型收敛到可订阅类型集合；非订阅类型（含转发/未知）返回 false。 */
function isSubscribed(type: BilibiliDynamicType, types: readonly DynamicSubscribeType[]): boolean {
  return (types as readonly string[]).includes(type);
}

/** 把 API 层动态转换成写库所需的字段。 */
function toNewItem(dynamic: BilibiliDynamic) {
  return {
    dynamicId: dynamic.id,
    uid: dynamic.uid,
    type: dynamic.type,
    title: dynamic.title,
    content: dynamic.text || null,
    url: dynamic.url,
    coverUrl: dynamic.coverUrl,
    imageUrls: dynamic.imageUrls,
    authorName: dynamic.authorName,
    publishedAt: dynamic.publishedAt,
  };
}

export interface PollStreamerOptions {
  streamer: MonitoredStreamer;
  fetcher: DynamicFetcher;
  storage: StorageOptions;
  logger: DynamicLogger;
  now: () => Date;
  /** 单次 fetch 的条数上限。 */
  fetchLimit?: number;
}

export interface PollResult {
  kind: "bootstrap" | "incremental" | "unchanged";
  discovered: number;
  enqueued: number;
}

/**
 * 轮询单个 UP 主一次：首次 bootstrap，之后增量发现并入队。
 *
 * 关键约束（对应设计文档 §6）：
 * - 首次同步成功时，把可见动态标记为 `bootstrap`（记录但不推送），并置 initialized=true。
 * - 首次同步失败时不置 initialized，下次仍是 bootstrap。
 * - 请求/解析失败直接抛出，**不推进游标、不写任何状态**。
 * - 正常轮询：只有请求成功后才写库并推进游标；重复 dynamic_id 不会重复入队。
 * - 置顶、未订阅类型：新动态写入但记为 skipped（不推送）。
 */
export async function pollStreamerOnce(options: PollStreamerOptions): Promise<PollResult> {
  const { streamer, fetcher, storage, logger, now } = options;
  const state = readDynamicMonitorState(streamer.uid, storage);
  const initialized = state?.initialized ?? false;

  // 请求失败会在此抛出，调用方据此退避；游标与状态保持不变。
  const dynamics = await fetcher.fetchUserDynamics(streamer.uid, options.fetchLimit ?? 20);
  const checkedAt = now().toISOString();

  if (!initialized) {
    // bootstrap：记录所有可见动态，标记 bootstrap，不推送。
    const items = dynamics.map(toNewItem);
    const newest = dynamics.length > 0 ? dynamics[0].id : null;
    recordDiscoveredDynamics({
      uid: streamer.uid,
      items,
      pushStatus: "bootstrap",
      lastDynamicId: newest,
      discoveredAt: checkedAt,
      initialized: true,
      options: storage,
    });
    logger.info(
      `[动态监控] uid=${streamer.uid}（${streamer.streamer}）首次同步完成，记录 ${items.length} 条历史动态，不推送`,
    );
    return { kind: "bootstrap", discovered: items.length, enqueued: 0 };
  }

  // 增量：过滤出订阅类型的新动态作为 pending，其余作为 skipped 记录。
  const pendingItems: ReturnType<typeof toNewItem>[] = [];
  const skippedItems: ReturnType<typeof toNewItem>[] = [];
  for (const dynamic of dynamics) {
    const item = toNewItem(dynamic);
    if (isSubscribed(dynamic.type, streamer.types)) {
      pendingItems.push(item);
    } else {
      skippedItems.push(item);
    }
  }

  const newest = dynamics.length > 0 ? dynamics[0].id : (state?.lastDynamicId ?? null);
  let enqueued = 0;
  if (pendingItems.length > 0) {
    enqueued = recordDiscoveredDynamics({
      uid: streamer.uid,
      items: pendingItems,
      pushStatus: "pending",
      lastDynamicId: newest,
      discoveredAt: checkedAt,
      initialized: true,
      options: storage,
    });
  }
  if (skippedItems.length > 0) {
    recordDiscoveredDynamics({
      uid: streamer.uid,
      items: skippedItems,
      pushStatus: "bootstrap", // 先以不可推送状态落库…
      lastDynamicId: newest,
      discoveredAt: checkedAt,
      initialized: true,
      options: storage,
    });
    // …再标记为 skipped，避免它们出现在 pending。
    for (const item of skippedItems) {
      markDynamicSkipped({ dynamicId: item.dynamicId, options: storage });
    }
  }
  if (pendingItems.length === 0 && skippedItems.length === 0) {
    // 无新动态：只推进检查时间，不动游标。
    touchMonitorCheck({ uid: streamer.uid, checkedAt, options: storage });
  }

  if (enqueued > 0) {
    logger.info(
      `[动态监控] uid=${streamer.uid}（${streamer.streamer}）发现 ${enqueued} 条新动态，已入队待推送`,
    );
  }
  return {
    kind: enqueued > 0 ? "incremental" : "unchanged",
    discovered: dynamics.length,
    enqueued,
  };
}

export interface FlushOptions {
  storage: StorageOptions;
  pusher: DynamicPusher;
  logger: DynamicLogger;
  now: () => Date;
  /** 仅处理这些 UID 的 pending；不传则处理全部（重启恢复用）。 */
  uids?: ReadonlySet<number>;
  /** 每个 UID 用于路由的群列表与开关。 */
  routeFor: (uid: number) => { notifyGroups: number[]; enableNotify: boolean } | undefined;
}

export interface FlushResult {
  attempted: number;
  success: number;
  failed: number;
  skipped: number;
}

/**
 * 发送 outbox 中所有 pending 动态（按发现时间升序）。
 *
 * - 每条 pending 用其 uid 找到归属群与开关；无群或不开启通知即跳过（skipped）。
 * - 发送成功标记 success；失败保留 pending 并记录错误，等待下次重试。
 * - 单条失败不影响后续；重启后再次调用即可续发。
 */
export async function flushPendingDynamics(options: FlushOptions): Promise<FlushResult> {
  const pending = listPendingDynamics(options.storage);
  const result: FlushResult = { attempted: 0, success: 0, failed: 0, skipped: 0 };

  for (const item of pending) {
    if (options.uids && !options.uids.has(item.uid)) continue;
    result.attempted += 1;

    const route = options.routeFor(item.uid);
    if (!route || !route.enableNotify || route.notifyGroups.length === 0) {
      markDynamicSkipped({
        dynamicId: item.dynamicId,
        reason: "无通知群或未开启通知",
        options: options.storage,
      });
      result.skipped += 1;
      continue;
    }

    const formatted = formatDynamic(recordToDynamic(item));
    let sendResult: SendResult;
    try {
      sendResult = await options.pusher(formatted, route.notifyGroups);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markDynamicFailed({ dynamicId: item.dynamicId, error: message, options: options.storage });
      options.logger.error(`[动态监控] 推送动态 ${item.dynamicId} 失败`, error);
      result.failed += 1;
      continue;
    }

    if (sendResult.delivered) {
      markDynamicSuccess({
        dynamicId: item.dynamicId,
        pushedAt: options.now().toISOString(),
        options: options.storage,
      });
      result.success += 1;
    } else {
      const message = sendResult.errors.join("; ") || "所有目标群发送失败";
      markDynamicFailed({ dynamicId: item.dynamicId, error: message, options: options.storage });
      options.logger.warn(`[动态监控] 动态 ${item.dynamicId} 未成功送达任何群：${message}`);
      result.failed += 1;
    }
  }

  return result;
}

/** 把库中的记录还原成 API 层动态结构，供 formatter 复用。 */
function recordToDynamic(item: DynamicItemRecord): BilibiliDynamic {
  return {
    id: item.dynamicId,
    uid: item.uid,
    authorName: item.authorName ?? "",
    authorFace: null,
    type: item.type as BilibiliDynamicType,
    publishedAt: item.publishedAt,
    text: item.content ?? "",
    title: item.title,
    url: item.url,
    coverUrl: item.coverUrl,
    imageUrls: item.imageUrls,
  };
}
