export interface MonitorMessageConfig {
  liveStart: string;
  liveEnd: string;
}

export interface MonitorFeatureOptions {
  roomId: number;
  streamer: string;
  /** B 站用户 ID，用于按 UID 查询直播详情。 */
  uid?: number;
  notifyEnabled?: boolean;
  notifyGroupIds?: number[];
  messages?: Partial<MonitorMessageConfig>;
}

export interface MonitorSourceHandlers {
  onLiveStart(event: { timestamp: Date; hasLiveTime: boolean }): void | Promise<void>;
  onIncomeDanmu(event: { timestamp: Date; content: string }): void | Promise<void>;
  onLiveEnd(event: { timestamp: Date }): void | Promise<void>;
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
      type: "live.ended";
      roomId: number;
      streamer: string;
      message: string;
      timestamp: Date;
    }
  | {
      type: "monitor.test";
      roomId: number;
      streamer: string;
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
}

export interface CreateMonitorOptions extends MonitorFeatureOptions {
  source: MonitorSource;
  sinks?: MonitorSink[];
  logger?: MonitorLogger;
}
