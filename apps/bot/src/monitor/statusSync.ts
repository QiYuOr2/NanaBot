import { live } from "@nana/bilibili-api";
import { writeLiveStatus, type StorageOptions } from "@nana/storage";
import type { MonitorStreamerConfig } from "./config";

export interface SyncLiveStatusOptions extends StorageOptions {
  /** 覆盖 B 站直播 API 的默认域名。 */
  baseUrl?: string;
  /** 覆盖默认的 fetch 实现，便于测试注入。 */
  fetch?: typeof globalThis.fetch;
}

/**
 * 在应用启动完成后，按 UID 查询 B 站直播状态并同步写入本地 SQLite。
 *
 * 对应 B 站接口 `get_status_info_by_uids`（即 @nana/bilibili-api 的
 * `live.getLiveStatusByUids`），返回值以 UID 字符串为键。
 */
export async function syncLiveStatus(
  streamers: MonitorStreamerConfig[],
  options: SyncLiveStatusOptions = {},
): Promise<void> {
  const uids = streamers.map((streamer) => streamer.uid);
  if (uids.length === 0) {
    return;
  }

  const statusByUid = await live.getLiveStatusByUids(uids, {
    baseUrl: options.baseUrl,
    fetch: options.fetch,
  });

  const syncedAt = new Date().toISOString();
  for (const streamer of streamers) {
    const info = statusByUid[String(streamer.uid)];
    if (!info) {
      console.error(
        `[直播监控] 未查询到主播 "${streamer.streamer}" (uid=${streamer.uid}) 的直播状态`,
      );
      continue;
    }

    writeLiveStatus(
      streamer.roomId,
      {
        streamer: streamer.streamer,
        live: info.live_status === 1,
        updatedAt: syncedAt,
      },
      options,
    );

    console.log(
      `[直播监控] 已同步 "${streamer.streamer}" 直播间 ${streamer.roomId} 状态：${
        info.live_status === 1 ? "直播中" : "未开播"
      }`,
    );
  }
}
