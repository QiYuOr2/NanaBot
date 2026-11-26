/** 触发下播宽限期的异常中断原因。 */
export type LiveInterruptionReason = "cut_off" | "short_live";

/** 最终确认下播的原因。 */
export type LiveEndReason = "normal" | "cut_off" | "short_live";

export interface MonitorMessageConfig {
  liveStart: string;
  liveEnd: string;
  /** 宽限期内重新开播的文案模板（强制去掉 `{@all}`）；未配置时沿用 `liveStart` 去 `{@all}`。 */
  liveResume?: string;
  /** 超管切断通知文案模板（支持 `{uname}`、`{roomId}`、`{reason}`，强制去掉 `{@all}`）。 */
  liveCutOff?: string;
}

export interface MonitorFeatureOptions {
  roomId: number;
  streamer: string;
  /** B 站用户 ID，用于按 UID 查询直播详情。 */
  uid?: number;
  notifyEnabled?: boolean;
  notifyGroupIds?: number[];
  messages?: Partial<MonitorMessageConfig>;
  /** 异常中断（超管切断 / 直播时长不足）的宽限期（毫秒）。默认 10 分钟；0 表示关闭宽限期。 */
  gracePeriodMs?: number;
  /** 视为正常下播的最短直播时长（毫秒）。不足此时长触发下播进入宽限期。默认 30 分钟；0 表示不按时长判定。 */
  minNormalLiveMs?: number;
}

export interface MonitorSourceHandlers {
  onLiveStart(event: { timestamp: Date; hasLiveTime: boolean }): void | Promise<void>;
  /**
   * 收到一条普通弹幕。
   * `userId` / `username` 来自 blive-message-listener 的 `user.uid` / `user.uname`，
   * 主播侧用于词云统计等需要区分发送者的场景。
   */
  onIncomeDanmu(event: {
    timestamp: Date;
    content: string;
    userId: number;
    username: string;
  }): void | Promise<void>;
  onLiveEnd(event: { timestamp: Date }): void | Promise<void>;
  /** 直播间被超管切断（B 站 `CUT_OFF` 事件）。 */
  onRoomCutOff(event: { timestamp: Date; reason: string }): void | Promise<void>;
  onOpen(): void | Promise<void>;
  onClose(): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
}

export interface MonitorSource {
  listen(roomId: number, handlers: MonitorSourceHandlers): MonitorSubscription;
}

export interface MonitorSubscription {
  close(): void | Promise<void>;
}

export type MonitorEvent =
  | {
      type: "live.started";
      roomId: number;
      streamer: string;
      message: string;
      timestamp: Date;
    }
  | {
      /** 宽限期内重新开播，视为同一场续播，通知不带 `@all`。 */
      type: "live.resumed";
      roomId: number;
      streamer: string;
      interruptedBy: LiveInterruptionReason;
      message: string;
      timestamp: Date;
      /** 通过宽限期到期校验静默恢复（未收到实时 LIVE 包），仅同步状态、不补发群消息。 */
      silent?: boolean;
    }
  | {
      /** 直播间被超管切断。 */
      type: "live.cutoff";
      roomId: number;
      streamer: string;
      reason: string;
      message: string;
      timestamp: Date;
    }
  | {
      type: "live.ended";
      roomId: number;
      streamer: string;
      message: string;
      timestamp: Date;
      /** 确认下播的原因；直接构造事件时可省略，默认按正常下播处理。 */
      reason?: LiveEndReason;
      /** 若因超管切断后宽限期到期而结束，附带最近一次切断原因。 */
      cutOffReason?: string;
    }
  | {
      type: "monitor.test";
      roomId: number;
      streamer: string;
      timestamp: Date;
    }
  | {
      /**
       * 收到一条弹幕（blive 普通弹幕，sub_type=comment）。
       * 内容为空时不发出该事件。
       */
      type: "danmu.received";
      roomId: number;
      streamer: string;
      content: string;
      userId: number;
      username: string;
      timestamp: Date;
    }
  | {
      type: "connection.open";
      roomId: number;
      streamer: string;
    }
  | {
      type: "connection.close";
      roomId: number;
      streamer: string;
    }
  | {
      type: "connection.error";
      roomId: number;
      streamer: string;
      error: unknown;
    };

export interface MonitorSink {
  handle(event: MonitorEvent): void | Promise<void>;
}

export interface MonitorLogger {
  log(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface MonitorController {
  start(): void;
  stop(): Promise<void>;
  /** 同步初始直播状态（例如进程在直播中途重启时），避免丢开播时长或把重连误判为全新开播。 */
  syncLiveState(state: { live: boolean; startedAt?: Date }): void;
  /** 当前是否处于异常中断后的宽限期中。 */
  isInGracePeriod(): boolean;
  /**
   * 外部兜底轮询发现主播已不在播时调用。
   * 若监控器当前处于宽限期或本次应进入宽限期，返回 true（由监控器接管）；
   * 否则将状态置回 offline 并返回 false，允许调用方立即按轮询兜底收尾。
   */
  handlePollOffline(timestamp?: Date): boolean;
}

export interface CreateMonitorOptions extends MonitorFeatureOptions {
  source: MonitorSource;
  sinks?: MonitorSink[];
  logger?: MonitorLogger;
  /** 宽限期到期时向 B 站二次确认主播是否仍在播；返回 true 时取消下播。 */
  checkLiveStatus?: () => Promise<boolean>;
  /** 宽限期定时器是否 unref（默认 true）。 */
  unrefTimers?: boolean;
}
