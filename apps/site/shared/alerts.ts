import type { AppState, OfflineAlertRecord } from "@nana/storage";

/** 告警页一次加载的历史条数。 */
export const BOT_ALERT_LIMIT = 100;

const REASON_LABELS: Record<string, string> = {
  heartbeat: "心跳",
  "socket.close": "连接断开",
  "socket.open": "连接恢复",
};

/** 把检测器的触发来源换成页面上的说法。未知来源原样显示。 */
export function labelOfflineReason(reason: string | null): string {
  if (!reason) {
    return "未知";
  }
  return REASON_LABELS[reason] ?? reason;
}

export interface BotAlertItem {
  id: number;
  kind: OfflineAlertRecord["kind"];
  offlineSince: string;
  downtimeMs: number | null;
  /** 已格式化的离线时长，仅恢复告警有值。 */
  downtimeText: string | null;
  reason: string | null;
  reasonLabel: string;
  createdAt: string;
}

export interface BotAlertState {
  online: boolean;
  offlineSince: string | null;
  lastOfflineAlertAt: string | null;
  lastOnlineAlertAt: string | null;
}

export interface BotAlertsResponse {
  state: BotAlertState | null;
  alerts: BotAlertItem[];
  generatedAt: string;
}

export function toBotAlertState(state: AppState): BotAlertState {
  return {
    online: state.online,
    offlineSince: state.offlineSince,
    lastOfflineAlertAt: state.lastOfflineAlertAt,
    lastOnlineAlertAt: state.lastOnlineAlertAt,
  };
}
