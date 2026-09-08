import { formatDuration } from "@nana/utils";
import type { OfflineAlert } from "./types.ts";

/** 把离线告警渲染成通用通知消息（结构上与 @nana/notify 的 NotifyMessage 兼容）。 */
export function renderOfflineAlert(alert: OfflineAlert): { subject: string; text: string } {
  return alert.kind === "offline"
    ? {
        subject: "「NanaBot」离线通知",
        text: [
          "检测到机器人已断开连接。",
          `触发来源: ${alert.reason ?? "未知"}`,
          `离线时间: ${alert.offlineSince}`,
        ].join("\n"),
      }
    : {
        subject: "「NanaBot」恢复通知",
        text: [
          "机器人已恢复连接。",
          `离线时间: ${alert.offlineSince}`,
          `离线时长: ${formatDuration(alert.downtimeMs ?? 0)}`,
        ].join("\n"),
      };
}
