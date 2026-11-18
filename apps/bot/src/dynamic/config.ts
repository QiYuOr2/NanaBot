import { readConfig } from "@nana/config";
import { z } from "zod";

/** 第一阶段支持的动态类型（与 API 层 `BilibiliDynamicType` 对齐，转发/未知不作为订阅目标）。 */
export const DYNAMIC_TYPES = ["video", "opus", "draw", "article"] as const;
export type DynamicSubscribeType = (typeof DYNAMIC_TYPES)[number];

/** 启用动态监控的一个 UP 主。 */
export interface DynamicStreamerConfig {
  uid: number;
  streamer: string;
  /** 该 UP 主的动态由哪个 QQ 账号发送；未配置时不发送。 */
  qqAccount?: string;
  /** 是否把发现的新动态推送到 QQ 群。 */
  enableNotify: boolean;
  /** 动态通知群；空数组表示只监控记录、不发送。 */
  notifyGroups: number[];
  /** 订阅的动态类型；未命中类型的新动态会被跳过（记为 skipped）。 */
  types: DynamicSubscribeType[];
  /** 轮询间隔（分钟），已按上下限收敛。 */
  pollIntervalMinutes: number;
}

export interface DynamicMonitorConfig {
  streamers: DynamicStreamerConfig[];
  /** 全局并发上限（同时执行的 UID 轮询数）。 */
  concurrency: number;
}

/** 轮询间隔的上下限（分钟）：避免过高频率触发风控。 */
export const MIN_POLL_INTERVAL_MINUTES = 1;
export const MAX_POLL_INTERVAL_MINUTES = 60;
export const DEFAULT_POLL_INTERVAL_MINUTES = 5;
export const DEFAULT_DYNAMIC_CONCURRENCY = 3;

const DynamicMonitorConfigSchema = z
  .object({
    enableNotify: z.boolean().default(true),
    notifyGroups: z.array(z.number().int().positive()).default([]),
    types: z
      .array(z.enum(DYNAMIC_TYPES))
      .default(["video", "opus", "draw"] as DynamicSubscribeType[]),
    pollIntervalMinutes: z
      .number()
      .int()
      .min(MIN_POLL_INTERVAL_MINUTES)
      .max(MAX_POLL_INTERVAL_MINUTES)
      .default(DEFAULT_POLL_INTERVAL_MINUTES),
  })
  .optional()
  .transform((value) => value ?? DynamicMonitorConfigDefaults());

function DynamicMonitorConfigDefaults() {
  return {
    enableNotify: true,
    notifyGroups: [] as number[],
    types: ["video", "opus", "draw"] as DynamicSubscribeType[],
    pollIntervalMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
  };
}

const UpDynamicSchema = z.object({
  uid: z.number().int(),
  uname: z.string().min(1),
  qqAccount: z.string().min(1).optional(),
  /** 默认 false，保持旧配置兼容。 */
  dynamic: z.boolean().default(false),
  dynamicMonitorConfig: DynamicMonitorConfigSchema,
});

const RootSchema = z.object({
  up: z.array(UpDynamicSchema),
});

type UpDynamicConfig = z.infer<typeof UpDynamicSchema>;

/**
 * 独立读取动态监控配置。
 *
 * 与 `loadMonitorConfig()` 不同，本函数读取**所有** `up`，只看 `dynamic: true`，
 * 不要求 `live: true`。这样动态监控可以完全独立于直播监控启用。
 */
export function loadDynamicMonitorConfig(): DynamicMonitorConfig {
  const config = RootSchema.parse(readConfig());
  return {
    streamers: config.up.filter((entry) => entry.dynamic).map(toDynamicStreamerConfig),
    concurrency: DEFAULT_DYNAMIC_CONCURRENCY,
  };
}

function toDynamicStreamerConfig(entry: UpDynamicConfig): DynamicStreamerConfig {
  return {
    uid: entry.uid,
    streamer: entry.uname,
    ...(entry.qqAccount ? { qqAccount: entry.qqAccount } : {}),
    enableNotify: entry.dynamicMonitorConfig.enableNotify,
    notifyGroups: entry.dynamicMonitorConfig.notifyGroups,
    types: [...entry.dynamicMonitorConfig.types],
    pollIntervalMinutes: entry.dynamicMonitorConfig.pollIntervalMinutes,
  };
}
