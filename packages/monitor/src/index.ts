export interface MonitorMessageConfig {
  liveStart: string;
  liveEnd: string;
}

export interface MonitorFeatureOptions {
  roomId: number;
  streamer: string;
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

export function createMonitor(options: CreateMonitorOptions): MonitorController {
  const logger = options.logger ?? consoleLogger;
  let subscription: MonitorSubscription | undefined;

  function emit(event: MonitorEvent) {
    for (const sink of options.sinks ?? []) {
      Promise.resolve(sink.handle(event)).catch((error) => {
        logger.error(`处理监控事件 ${event.type} 失败`, error);
      });
    }
  }

  return {
    start() {
      if (subscription) {
        return;
      }

      subscription = options.source.listen(options.roomId, {
        onLiveStart(event) {
          const text = event.hasLiveTime
            ? renderMessage(options.messages?.liveStart ?? `${options.streamer} 开始直播`, options)
            : `${options.streamer} 推流 LOG`;

          if (event.hasLiveTime) {
            emit({
              type: "live.started",
              roomId: options.roomId,
              streamer: options.streamer,
              message: text,
              timestamp: event.timestamp,
            });
          }

          logger.log(`[${formatTimestamp(event.timestamp)}] ${text}`);
        },
        onIncomeDanmu(event) {
          if (event.content === "qiyuor2") {
            emit({
              type: "monitor.test",
              roomId: options.roomId,
              streamer: options.streamer,
              timestamp: event.timestamp,
            });
          }
        },
        onLiveEnd(event) {
          const text = renderMessage(
            options.messages?.liveEnd ?? `${options.streamer} 下播了`,
            options,
          );
          emit({
            type: "live.ended",
            roomId: options.roomId,
            streamer: options.streamer,
            message: text,
            timestamp: event.timestamp,
          });
          logger.log(`[${formatTimestamp(event.timestamp)}] ${text}`);
        },
        onOpen() {
          emit({ type: "connection.open", roomId: options.roomId, streamer: options.streamer });
          logger.log(`[直播监控] 已连接直播间 ${options.roomId}`);
        },
        onClose() {
          emit({ type: "connection.close", roomId: options.roomId, streamer: options.streamer });
          logger.log(`[直播监控] 直播间 ${options.roomId} 连接已关闭`);
        },
        onError(error) {
          emit({
            type: "connection.error",
            roomId: options.roomId,
            streamer: options.streamer,
            error,
          });
          logger.error(`[直播监控] 直播间 ${options.roomId} 监听异常`, error);
        },
      });
    },
    async stop() {
      const currentSubscription = subscription;
      subscription = undefined;
      await currentSubscription?.close();
    },
  };
}

function renderMessage(template: string, options: MonitorFeatureOptions): string {
  return template
    .replaceAll("{uname}", options.streamer)
    .replaceAll("{roomId}", String(options.roomId));
}

function formatTimestamp(timestamp: Date): string {
  return timestamp.toISOString();
}

const consoleLogger: MonitorLogger = {
  log: console.log,
  error: console.error,
};
