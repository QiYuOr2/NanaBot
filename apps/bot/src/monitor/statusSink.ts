import { live } from "@nana/bilibili-api";
import { writeLiveStatus, type LiveStatus, type StorageOptions } from "@nana/storage";
import type { MonitorEvent, MonitorSink } from "@nana/monitor";
import type { LiveStatusInfo } from "@nana/bilibili-api";
import { toLiveStatusFields } from "./liveInfo";

export interface LiveStatusSinkOptions extends StorageOptions {
  /** B 站用户 ID，用于按 UID 查询直播详情。 */
  uid?: number;
  /** 覆盖 B 站直播 API 的默认域名。 */
  baseUrl?: string;
  /** 覆盖默认的 fetch 实现，便于测试注入。 */
  fetch?: typeof globalThis.fetch;
}

export function createLiveStatusSink(options: LiveStatusSinkOptions = {}): MonitorSink {
  return {
    async handle(event: MonitorEvent) {
      if (event.type !== "live.started" && event.type !== "live.ended") {
        return;
      }

      const status: LiveStatus = {
        streamer: event.streamer,
        live: event.type === "live.started",
        updatedAt: event.timestamp.toISOString(),
      };

      if (options.uid) {
        try {
          const info = await fetchLiveStatusInfo(options.uid, options);
          const fields = toLiveStatusFields(info);
          status.title = fields.title;
          status.area = fields.area;
          status.viewer = fields.viewer;
        } catch (error) {
          console.error(`[直播监控] 拉取直播间 ${event.roomId} 详情失败`, error);
        }
      }

      writeLiveStatus(event.roomId, status, options);
    },
  };
}

async function fetchLiveStatusInfo(
  uid: number,
  options: LiveStatusSinkOptions,
): Promise<LiveStatusInfo> {
  const statusByUid = await live.getLiveStatusByUids([uid], {
    baseUrl: options.baseUrl,
    fetch: options.fetch,
  });

  const info = statusByUid[String(uid)];
  if (!info) {
    throw new Error(`未查询到 uid=${uid} 的直播详情`);
  }
  return info;
}
