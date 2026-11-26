import { startListen } from "blive-message-listener";
import type { DanmuMsg, Message, RoomWarnMsg } from "blive-message-listener";
import type { MonitorSource } from "./types.ts";

/** `MonitorSourceHandlers.onIncomeDanmu` 的入参，同时供映射函数复用。 */
type DanmuHandlerEvent = Parameters<Parameters<MonitorSource["listen"]>[1]["onIncomeDanmu"]>[0];
type RoomCutOffHandlerEvent = Parameters<Parameters<MonitorSource["listen"]>[1]["onRoomCutOff"]>[0];

export function createBliveMonitorSource(): MonitorSource {
  return {
    listen(roomId, handlers) {
      const listener = startListen(roomId, {
        onLiveStart: (message) =>
          handlers.onLiveStart({
            timestamp: new Date(message.timestamp),
            hasLiveTime: Boolean(message.raw["live_time"]),
          }),
        onIncomeDanmu: (message) => handlers.onIncomeDanmu(toDanmuHandlerEvent(message)),
        onLiveEnd: (message) => handlers.onLiveEnd({ timestamp: new Date(message.timestamp) }),
        onRoomWarn: (message) => {
          const cutOff = toRoomCutOffEvent(message);
          if (cutOff) {
            void handlers.onRoomCutOff(cutOff);
          }
        },
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

/**
 * 把 blive-message-listener 的房间警告/切断消息映射为超管切断事件。
 *
 * 仅处理 `type === "cut"`（B 站 `CUT_OFF`）；普通超管警告（`WARNING`）不中断推流，返回 undefined。
 */
export function toRoomCutOffEvent(
  message: Message<RoomWarnMsg>,
): RoomCutOffHandlerEvent | undefined {
  if (message.body?.type !== "cut") {
    return undefined;
  }
  return {
    timestamp: new Date(message.timestamp),
    reason: typeof message.body.msg === "string" ? message.body.msg.trim() : "",
  };
}

/**
 * 把 blive-message-listener 的弹幕消息映射成 handlers 入参。
 *
 * 发送者信息在 `body.user`（`User.uid` / `User.uname`）上，而不是 `body` 顶层；
 * 个别畸形消息可能缺少 `user`，此时兜底为 `userId: 0` / `username: ""`，
 * 避免监听回调抛错中断整条长连接。
 */
export function toDanmuHandlerEvent(message: Message<DanmuMsg>): DanmuHandlerEvent {
  return {
    timestamp: new Date(message.timestamp),
    content: message.body.content,
    userId: message.body.user?.uid ?? 0,
    username: message.body.user?.uname ?? "",
  };
}
