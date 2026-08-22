import { startListen } from "blive-message-listener";
import type { MonitorSource } from "./types.ts";

export function createBliveMonitorSource(): MonitorSource {
  return {
    listen(roomId, handlers) {
      const listener = startListen(roomId, {
        onLiveStart: (message) =>
          handlers.onLiveStart({
            timestamp: new Date(message.timestamp),
            hasLiveTime: Boolean(message.raw["live_time"]),
          }),
        onIncomeDanmu: (message) =>
          handlers.onIncomeDanmu({
            timestamp: new Date(message.timestamp),
            content: message.body.content,
          }),
        onLiveEnd: (message) => handlers.onLiveEnd({ timestamp: new Date(message.timestamp) }),
        onOpen: () => handlers.onOpen(),
        onClose: () => handlers.onClose(),
        onError: (error) => handlers.onError(error),
      });

      return {
        close() {
          listener.close();
        },
      };
    },
  };
}
