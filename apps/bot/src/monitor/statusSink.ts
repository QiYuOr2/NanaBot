import { updateStore, type StorageOptions } from "@nana/storage";
import type { MonitorEvent, MonitorSink } from "@nana/monitor";

export interface LiveStatus {
  streamer: string;
  live: boolean;
  updatedAt: string;
}

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

      updateStore("live-status.yaml", [String(event.roomId)], status, options);
    },
  };
}