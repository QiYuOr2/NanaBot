import type { OfflineAlert, OfflineState, OfflineStateStore } from "./types.ts";

export interface OfflineDetectorOptions {
  store: OfflineStateStore;
  /** 连续多少次判定离线才算真正的掉线，默认 3。 */
  confirmCount?: number;
  /** 是否在恢复后发送通知，默认 true。 */
  notifyRecovery?: boolean;
  /** 时钟注入点，便于测试，默认 Date.now。 */
  now?: () => number;
}

const DEFAULT_STATE: OfflineState = {
  online: true,
  offlineCount: 0,
  offlineSince: null,
  lastOfflineAlertAt: null,
  lastOnlineAlertAt: null,
};

/**
 * 机器人在线/离线状态机：
 * - 边沿触发：只在「在线→离线」「离线→在线」跳变时产生告警。
 * - 连续确认：心跳需连续 `confirmCount` 次离线才判定为真掉线。
 * - 持久化：状态写入 store，重启后不会立刻重复告警、能正确计算恢复时长。
 */
export class OfflineDetector {
  private state: OfflineState;
  private readonly store: OfflineStateStore;
  private readonly confirmCount: number;
  private readonly notifyRecovery: boolean;
  private readonly now: () => number;

  constructor(options: OfflineDetectorOptions) {
    this.state = options.store.read() ?? { ...DEFAULT_STATE };
    this.store = options.store;
    this.confirmCount = options.confirmCount ?? 3;
    this.notifyRecovery = options.notifyRecovery ?? true;
    this.now = options.now ?? (() => Date.now());
  }

  /** 用一条心跳更新状态。`isOnline` 为真表示 `status.online !== false`。 */
  reportHeartbeat(isOnline: boolean): OfflineAlert | undefined {
    if (isOnline) {
      return this.markOnline("heartbeat");
    }
    return this.accumulateOffline("heartbeat");
  }

  /** WebSocket 连接断开（`socket.close`）。连接层下线视为已确认，不再等待心跳计数。 */
  reportConnectionLost(reason = "socket.close"): OfflineAlert | undefined {
    if (this.state.online === false) {
      return undefined;
    }
    return this.transitionToOffline(reason);
  }

  /** WebSocket 重连成功（`socket.open`）。 */
  reportConnectionRestored(reason = "socket.open"): OfflineAlert | undefined {
    return this.markOnline(reason);
  }

  private markOnline(reason: string): OfflineAlert | undefined {
    const state = this.state;
    if (state.online === true) {
      if (state.offlineCount !== 0 || state.offlineSince != null) {
        state.offlineCount = 0;
        state.offlineSince = null;
        this.persist();
      }
      return undefined;
    }

    const offlineSince = state.offlineSince ?? this.iso(this.now());
    const downtimeMs = Math.max(0, this.now() - Date.parse(offlineSince));
    state.online = true;
    state.offlineCount = 0;
    state.offlineSince = null;
    state.lastOfflineAlertAt = null;
    state.lastOnlineAlertAt = this.iso(this.now());
    this.persist();

    if (!this.notifyRecovery) {
      return undefined;
    }
    return { kind: "recovered", offlineSince, downtimeMs, reason };
  }

  private accumulateOffline(reason: string): OfflineAlert | undefined {
    const state = this.state;
    if (state.online === false) {
      // 已经确认离线，不再重复告警，仅累计计数。
      state.offlineCount += 1;
      return undefined;
    }

    state.offlineCount += 1;
    if (state.offlineCount === 1) {
      state.offlineSince = this.iso(this.now());
      this.persist();
      return undefined;
    }

    if (state.offlineCount < this.confirmCount) {
      this.persist();
      return undefined;
    }

    return this.transitionToOffline(reason);
  }

  private transitionToOffline(reason: string): OfflineAlert | undefined {
    const state = this.state;
    state.online = false;
    state.offlineSince = state.offlineSince ?? this.iso(this.now());
    state.lastOfflineAlertAt = this.iso(this.now());
    this.persist();

    return { kind: "offline", offlineSince: state.offlineSince, reason };
  }

  private persist(): void {
    this.store.write(this.state);
  }

  private iso(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }
}
