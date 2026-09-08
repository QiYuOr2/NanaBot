/** 告警类型：掉线 / 恢复。 */
export type OfflineAlertKind = "offline" | "recovered";

/** 一次离线告警的上下文。 */
export interface OfflineAlert {
  kind: OfflineAlertKind;
  /** 本段离线开始时间（ISO 字符串）。 */
  offlineSince: string;
  /** 离线时长（ms），仅恢复通知携带。 */
  downtimeMs?: number;
  /** 触发来源，如 heartbeat / socket.close / socket.open。 */
  reason?: string;
}

/** 离线告警状态机的持久化状态。 */
export interface OfflineState {
  online: boolean;
  offlineCount: number;
  offlineSince: string | null;
  lastOfflineAlertAt: string | null;
  lastOnlineAlertAt: string | null;
}

/** 状态存取接口，由调用方绑定额外的持久化实现（如 SQLite）。 */
export interface OfflineStateStore {
  read(): OfflineState | undefined;
  write(state: OfflineState): void;
}
