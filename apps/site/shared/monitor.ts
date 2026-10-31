/**
 * 直播监控页的纯数据：把 `nana.config.yaml` 的 `up` 列表整理成可展示的监控配置。
 *
 * 只描述「监控怎么配」，不包含直播状态（那部分由 `/api/live-status` 负责）。
 * 群昵称不在配置里，调用方用推送记录里出现过的群名补上，缺的回退「群{id}」。
 */

/** 单个主播的监控配置。 */
export interface MonitorStreamer {
  uid: number;
  roomId: number;
  streamer: string;
  /** 是否纳入直播监控；`live: false` 的主播 bot 不会轮询。 */
  monitored: boolean;
  /** 开播 / 下播时是否向通知群推送。 */
  notifyEnabled: boolean;
  /** 开播通知文案模板，原样展示（含 `{uname}` 这类占位符）。 */
  messageTemplate: string | null;
  /** 通知目标群，顺序与配置文件一致。 */
  groups: MonitorGroup[];
}

/** 一个通知目标群。 */
export interface MonitorGroup {
  /** 群号（字符串，与推送记录的 `targetId` 对齐）。 */
  id: string;
  /** 群昵称；推送记录里没出现过时为「群{id}」。 */
  name: string;
  /** 群昵称是否只是回退文案，而不是从推送记录里解析出来的真名。 */
  fallback: boolean;
}

export interface MonitorSummary {
  /** 配置里的主播总数（含未开启监控的）。 */
  streamerCount: number;
  /** `live: true` 的主播数。 */
  monitoredCount: number;
  /** 开启了通知的主播数。 */
  notifyingCount: number;
  /** 全部主播通知群去重后的数量。 */
  groupCount: number;
}

export interface MonitorResponse {
  streamers: MonitorStreamer[];
  summary: MonitorSummary;
  /** 接口生成时间（ISO 字符串）。 */
  generatedAt: string;
}

/** `up` 列表里一项的原始形状；字段都可选，脏配置按「跳过」处理而不是整页失败。 */
export interface MonitorUpInput {
  live?: boolean;
  uid?: number;
  liveRoomId?: number;
  uname?: string;
  liveMonitorConfig?: {
    enableNotify?: boolean;
    /** 原始群号。非法值在转换时丢掉，不让一条脏群号弄丢整个主播。 */
    notifyGroups?: readonly unknown[];
    messageTemplate?: { start?: string };
  };
}

/** 群号 → 群昵称。来自推送记录，同一个群取最近一次出现的名字。 */
export type GroupNameMap = ReadonlyMap<string, string>;

const GROUP_ID_PATTERN = /^\d+$/;

/** 配置里没有群名时的回退文案，与 bot 侧 `NapcatPushClient` 的回退保持一致。 */
export function fallbackGroupName(groupId: string): string {
  return `群${groupId}`;
}

/**
 * 从推送记录里收集群昵称。
 *
 * 记录按时间倒序传入时，每个群第一次出现的就是最新的名字；回退文案
 * （「群{id}」）不采用，免得把一次解析失败固化成群名。
 */
export function collectGroupNames(
  logs: readonly { targetId: string; target: string }[],
): GroupNameMap {
  const names = new Map<string, string>();

  for (const log of logs) {
    if (names.has(log.targetId)) {
      continue;
    }
    const name = log.target.trim();
    if (!name || name === fallbackGroupName(log.targetId)) {
      continue;
    }
    names.set(log.targetId, name);
  }

  return names;
}

/** 正整数群号。数字和纯数字字符串都收，前导零和小数丢掉。 */
function groupIdString(groupId: unknown): string | undefined {
  if (typeof groupId === "number") {
    return Number.isInteger(groupId) && groupId > 0 ? String(groupId) : undefined;
  }

  if (typeof groupId !== "string" || !GROUP_ID_PATTERN.test(groupId)) {
    return undefined;
  }

  const numeric = Number(groupId);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || String(numeric) !== groupId) {
    return undefined;
  }

  return groupId;
}

function toMonitorGroup(groupId: unknown, names: GroupNameMap): MonitorGroup | undefined {
  const id = groupIdString(groupId);
  if (!id) {
    return undefined;
  }

  const name = names.get(id);
  return name ? { id, name, fallback: false } : { id, name: fallbackGroupName(id), fallback: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 把配置里的一项收成 `toMonitorStreamer` 能处理的形状。
 *
 * 字段类型不对（比如 `live: "false"`）时返回 `undefined`，调用方跳过这一项。
 * 缺字段不算错，缺省口径仍由 `toMonitorStreamer` 决定。
 */
function coerceUp(value: unknown): MonitorUpInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if ("live" in value && typeof value.live !== "boolean") {
    return undefined;
  }

  const monitorConfig = value.liveMonitorConfig;
  if (monitorConfig !== undefined && !isRecord(monitorConfig)) {
    return undefined;
  }

  let liveMonitorConfig: MonitorUpInput["liveMonitorConfig"];
  if (isRecord(monitorConfig)) {
    if ("enableNotify" in monitorConfig && typeof monitorConfig.enableNotify !== "boolean") {
      return undefined;
    }
    if ("notifyGroups" in monitorConfig && !Array.isArray(monitorConfig.notifyGroups)) {
      return undefined;
    }

    const template = monitorConfig.messageTemplate;
    if (template !== undefined && !isRecord(template)) {
      return undefined;
    }
    if (isRecord(template) && "start" in template && typeof template.start !== "string") {
      return undefined;
    }

    liveMonitorConfig = {
      enableNotify:
        typeof monitorConfig.enableNotify === "boolean" ? monitorConfig.enableNotify : undefined,
      notifyGroups: Array.isArray(monitorConfig.notifyGroups)
        ? monitorConfig.notifyGroups
        : undefined,
      messageTemplate:
        isRecord(template) && typeof template.start === "string"
          ? { start: template.start }
          : undefined,
    };
  }

  return {
    live: typeof value.live === "boolean" ? value.live : undefined,
    uid: typeof value.uid === "number" ? value.uid : undefined,
    liveRoomId: typeof value.liveRoomId === "number" ? value.liveRoomId : undefined,
    uname: typeof value.uname === "string" ? value.uname : undefined,
    liveMonitorConfig,
  };
}

/** 从整份配置里抽出可展示的主播。`up` 缺失、不是数组，或某一项是脏数据时，只跳过坏的部分。 */
export function monitorStreamersFromConfig(
  config: unknown,
  names: GroupNameMap,
): MonitorStreamer[] {
  if (!isRecord(config) || !Array.isArray(config.up)) {
    return [];
  }

  return config.up.flatMap((entry) => {
    const input = coerceUp(entry);
    const streamer = input ? toMonitorStreamer(input, names) : undefined;
    return streamer ? [streamer] : [];
  });
}

/**
 * 把一项 `up` 配置转成监控展示数据。
 *
 * 缺主播名、uid 或房间号的项返回 `undefined`（页面上展示不出来）；`live` 缺省按
 * 开启处理，与 `/api/live-status` 的口径一致。
 */
export function toMonitorStreamer(
  input: MonitorUpInput,
  names: GroupNameMap,
): MonitorStreamer | undefined {
  if (
    typeof input.uname !== "string" ||
    input.uname.trim() === "" ||
    !Number.isInteger(input.uid) ||
    !Number.isInteger(input.liveRoomId)
  ) {
    return undefined;
  }

  const config = input.liveMonitorConfig;
  const template = config?.messageTemplate?.start?.trim();
  const seen = new Set<string>();
  const groups: MonitorGroup[] = [];

  for (const groupId of config?.notifyGroups ?? []) {
    const group = toMonitorGroup(groupId, names);
    // 同一个群配了两次只展示一次，保留首次出现的顺序。
    if (!group || seen.has(group.id)) {
      continue;
    }
    seen.add(group.id);
    groups.push(group);
  }

  return {
    uid: input.uid as number,
    roomId: input.liveRoomId as number,
    streamer: input.uname.trim(),
    monitored: input.live ?? true,
    notifyEnabled: config?.enableNotify ?? true,
    messageTemplate: template ? template : null,
    groups,
  };
}

/** 汇总一页监控配置的计数，供页面顶部的统计条使用。 */
export function summarizeMonitor(streamers: readonly MonitorStreamer[]): MonitorSummary {
  const groupIds = new Set<string>();
  let monitoredCount = 0;
  let notifyingCount = 0;

  for (const streamer of streamers) {
    if (streamer.monitored) {
      monitoredCount += 1;
    }
    if (streamer.monitored && streamer.notifyEnabled && streamer.groups.length > 0) {
      notifyingCount += 1;
    }
    for (const group of streamer.groups) {
      groupIds.add(group.id);
    }
  }

  return {
    streamerCount: streamers.length,
    monitoredCount,
    notifyingCount,
    groupCount: groupIds.size,
  };
}
