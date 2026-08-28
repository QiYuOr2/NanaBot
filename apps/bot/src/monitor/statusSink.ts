import { writeLiveStatus, type LiveStatus, type StorageOptions } from "@nana/storage";
import type { MonitorEvent, MonitorSink } from "@nana/monitor";

export type { LiveStatus } from "@nana/storage";

export function createLiveStatusSink(options?: StorageOptions): MonitorSink {
  return {
    handle(event: MonitorEvent) {
      if (event.type !== "live.started" && event.type !== "live.ended") {
        return;
      }

      const status: LiveStatus = {
        streamer: event.streamer,
        live: event.type === "live.started",
        updatedAt: event.timestamp.toISOString(),
      };

      writeLiveStatus(event.roomId, status, options);
    },
  };
}
