import { live } from "@nana/bilibili-api";
import { readConfig } from "@nana/config";
import {
  readAllLiveStatus,
  readLatestCutOffByRooms,
  writeLiveStatus,
  type DanmuSessionCutOff,
  type LiveStatus,
} from "@nana/storage";
import type { LiveStatusInfo } from "@nana/bilibili-api";
import { z } from "zod";

/** 超过该时间或被后续正常下播覆盖的切断记录不再在概览卡片上标红提示。 */
const RECENT_CUT_OFF_WINDOW_MS = 24 * 60 * 60 * 1000;
const CUT_OFF_STATUS_SKEW_MS = 15 * 60 * 1000;

const UpSchema = z
  .object({
    live: z.boolean().optional().default(true),
    uid: z.number().int(),
    // 只开启动态监控的 UP 主（live: false）可以没有直播间；与 bot 侧 monitor/config 的规则一致。
    liveRoomId: z.number().int().optional(),
    uname: z.string().min(1),
  })
  .superRefine((entry, context) => {
    if (entry.live && entry.liveRoomId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["liveRoomId"],
        message: "live: true 时必须配置 liveRoomId",
      });
    }
  });

const ConfigSchema = z.object({
  up: z.array(UpSchema).optional().default([]),
});

export interface StreamerConfig {
  uid: number;
  roomId: number;
  streamer: string;
}

export interface StreamerCutOffDto {
  cutOffAt: string;
  reason: string;
}

export interface StreamerStatusDto {
  streamer: string;
  roomId: number;
  live: boolean;
  title: string | null;
  area: string | null;
  viewer: number | null;
  updatedAt: string | null;
  /** 最近一次仍有效的超管切断记录（离线且未经过新一轮正常下播时展示）。 */
  lastCutOff?: StreamerCutOffDto | null;
}

export function loadStreamerConfigs(): StreamerConfig[] {
  const config = ConfigSchema.parse(readConfig());
  return config.up
    .filter((entry) => entry.live)
    .map((entry) => {
      // UpSchema 的 superRefine 已保证 live 的条目一定有 liveRoomId。
      if (entry.liveRoomId === undefined) {
        throw new Error(`主播 ${entry.uname} 启用了直播监控，但缺少 liveRoomId。`);
      }
      return {
        uid: entry.uid,
        roomId: entry.liveRoomId,
        streamer: entry.uname,
      };
    });
}

/** 合并配置中的主播列表与数据库中的直播状态。 */
export function buildStreamerStatuses(): StreamerStatusDto[] {
  const configs = loadStreamerConfigs();
  const statuses = readAllLiveStatus();
  const statusByRoom = new Map(statuses.map((status) => [status.roomId, status]));
  const cutOffByRoom = new Map(readLatestCutOffByRooms().map((cutOff) => [cutOff.roomId, cutOff]));

  return configs.map((config) => {
    const status = statusByRoom.get(String(config.roomId));
    const liveNow = status?.live ?? false;
    const updatedAt = status?.updatedAt ?? null;
    const lastCutOff = resolveActiveCutOff(
      liveNow,
      updatedAt,
      cutOffByRoom.get(String(config.roomId)),
    );
    return {
      streamer: config.streamer,
      roomId: config.roomId,
      live: liveNow,
      title: status?.title ?? null,
      area: status?.area ?? null,
      viewer: status?.viewer ?? null,
      updatedAt,
      lastCutOff,
    };
  });
}

function resolveActiveCutOff(
  liveNow: boolean,
  updatedAt: string | null,
  cutOff: DanmuSessionCutOff | undefined,
): StreamerCutOffDto | null {
  if (liveNow || !cutOff) {
    return null;
  }
  const cutOffTime = Date.parse(cutOff.cutOffAt);
  if (!Number.isFinite(cutOffTime) || Date.now() - cutOffTime > RECENT_CUT_OFF_WINDOW_MS) {
    return null;
  }
  if (updatedAt) {
    const updatedTime = Date.parse(updatedAt);
    if (Number.isFinite(updatedTime) && cutOffTime < updatedTime - CUT_OFF_STATUS_SKEW_MS) {
      return null;
    }
  }
  return { cutOffAt: cutOff.cutOffAt, reason: cutOff.reason };
}

function toStoredStatus(config: StreamerConfig, info: LiveStatusInfo): LiveStatus {
  return {
    streamer: config.streamer,
    live: info.live_status === 1,
    title: info.title || null,
    area: info.area_v2_name || null,
    viewer: info.online || null,
    updatedAt: new Date().toISOString(),
  };
}

/** 主动调用 B 站直播 API，并更新该主播在数据库中的状态。 */
export async function refreshStreamer(roomId: number): Promise<StreamerStatusDto | undefined> {
  const config = loadStreamerConfigs().find((entry) => entry.roomId === roomId);
  if (!config) {
    return undefined;
  }

  const statusByUid = await live.getLiveStatusByUids([config.uid]);
  const info = statusByUid[String(config.uid)];
  if (!info) {
    return undefined;
  }

  const stored = toStoredStatus(config, info);
  writeLiveStatus(roomId, stored);

  const cutOffByRoom = new Map(readLatestCutOffByRooms().map((cutOff) => [cutOff.roomId, cutOff]));

  return {
    streamer: stored.streamer,
    roomId,
    live: stored.live,
    title: stored.title ?? null,
    area: stored.area ?? null,
    viewer: stored.viewer ?? null,
    updatedAt: stored.updatedAt,
    lastCutOff: resolveActiveCutOff(
      stored.live,
      stored.updatedAt,
      cutOffByRoom.get(String(roomId)),
    ),
  };
}
