import type { LiveStatusInfo } from "@nana/bilibili-api";
import type { LiveStatus } from "@nana/storage";

/** 是否为直播中（B 站 live_status: 1 表示直播中，2 为轮播）。 */
export function isLiveStatus(info: LiveStatusInfo): boolean {
  return info.live_status === 1;
}

/** 从 B 站直播详情中提取需要持久化的标题、分区与人数。 */
export function toLiveStatusFields(info: LiveStatusInfo): {
  title: string | null;
  area: string | null;
  viewer: number | null;
} {
  return {
    title: info.title || null,
    area: info.area_v2_name || null,
    viewer: info.online || null,
  };
}

/** 构造一条要写入 SQLite 的直播状态；传入 `info` 时填充标题、分区与人数。 */
export function buildLiveStatus(input: {
  streamer: string;
  live: boolean;
  updatedAt: string;
  info?: LiveStatusInfo;
}): LiveStatus {
  const status: LiveStatus = {
    streamer: input.streamer,
    live: input.live,
    updatedAt: input.updatedAt,
  };

  if (input.info) {
    const fields = toLiveStatusFields(input.info);
    status.title = fields.title;
    status.area = fields.area;
    status.viewer = fields.viewer;
  }

  return status;
}
