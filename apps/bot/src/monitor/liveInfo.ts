import type { LiveStatusInfo } from "@nana/bilibili-api";

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
