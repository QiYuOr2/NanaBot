import { readAppState, readOfflineAlerts } from "@nana/storage";
import { formatDuration } from "@nana/utils";
import { defineEventHandler } from "h3";
import { BOT_ALERT_LIMIT, labelOfflineReason, toBotAlertState } from "../../shared/alerts.ts";
import type { BotAlertItem } from "../../shared/alerts.ts";

function toAlertItem(alert: ReturnType<typeof readOfflineAlerts>[number]): BotAlertItem {
  return {
    id: alert.id,
    kind: alert.kind,
    offlineSince: alert.offlineSince,
    downtimeMs: alert.downtimeMs,
    downtimeText: alert.downtimeMs == null ? null : formatDuration(alert.downtimeMs),
    reason: alert.reason,
    reasonLabel: labelOfflineReason(alert.reason),
    createdAt: alert.createdAt,
  };
}

/** 机器人当前在线状态，以及最近的离线 / 恢复告警。 */
export default defineEventHandler(() => {
  const state = readAppState();
  const alerts = readOfflineAlerts(undefined, BOT_ALERT_LIMIT).map(toAlertItem);

  return {
    state: state ? toBotAlertState(state) : null,
    alerts,
    generatedAt: new Date().toISOString(),
  };
});
