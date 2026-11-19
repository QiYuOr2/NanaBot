import { live } from "@nana/bilibili-api";
import { readConfig } from "@nana/config";
import { readAllLiveStatus, writeLiveStatus, type LiveStatus } from "@nana/storage";
import type { LiveStatusInfo } from "@nana/bilibili-api";
import { z } from "zod";

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

export interface StreamerStatusDto {
  streamer: string;
  roomId: number;
  live: boolean;
  title: string | null;
  area: string | null;
  viewer: number | null;
  updatedAt: string | null;
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

  return configs.map((config) => {
    const status = statusByRoom.get(String(config.roomId));
    return {
      streamer: config.streamer,
      roomId: config.roomId,
      live: status?.live ?? false,
      title: status?.title ?? null,
      area: status?.area ?? null,
      viewer: status?.viewer ?? null,
      updatedAt: status?.updatedAt ?? null,
    };
  });
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

  return {
    streamer: stored.streamer,
    roomId,
    live: stored.live,
    title: stored.title ?? null,
    area: stored.area ?? null,
    viewer: stored.viewer ?? null,
    updatedAt: stored.updatedAt,
  };
}
