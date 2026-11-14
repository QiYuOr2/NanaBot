import { formatDuration } from "@nana/utils";
import type { OfflineAlert } from "./types.ts";

/** 渲染告警时的额外上下文。 */
export interface OfflineAlertContext {
  /** 本次断开发生在部署窗口内时，携带部署标记信息，告警改用「部署中」措辞。 */
  deployment?: {
    startedAt: string;
    ref?: string;
  };
}

/** 把离线告警渲染成通用通知消息（结构上与 @nana/notify 的 NotifyMessage 兼容）。 */
export function renderOfflineAlert(
  alert: OfflineAlert,
  context: OfflineAlertContext = {},
): { subject: string; text: string } {
  if (context.deployment) {
    const version = context.deployment.ref ? [`部署版本: ${context.deployment.ref}`] : [];
    return alert.kind === "offline"
      ? {
          subject: "「NanaBot」部署中通知",
          text: [
            "机器人正在部署更新，本次断开是计划内重启，不是故障掉线。",
            `部署开始: ${context.deployment.startedAt}`,
            ...version,
            `触发来源: ${alert.reason ?? "未知"}`,
            `离线时间: ${alert.offlineSince}`,
          ].join("\n"),
        }
      : {
          subject: "「NanaBot」部署完成通知",
          text: [
            "部署更新已完成，机器人已恢复连接。",
            `部署开始: ${context.deployment.startedAt}`,
            ...version,
            `离线时间: ${alert.offlineSince}`,
            `离线时长: ${formatDuration(alert.downtimeMs ?? 0)}`,
          ].join("\n"),
        };
  }
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
