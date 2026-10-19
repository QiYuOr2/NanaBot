import type {
  CreateMonitorOptions,
  MonitorController,
  MonitorEvent,
  MonitorFeatureOptions,
  MonitorLogger,
  MonitorSourceHandlers,
  MonitorSubscription,
} from "./types.ts";

export function createMonitor(options: CreateMonitorOptions): MonitorController {
  const logger = options.logger ?? consoleLogger;
  let subscription: MonitorSubscription | undefined;

  function emit(event: MonitorEvent): void {
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

      subscription = options.source.listen(options.roomId, createHandlers(options, emit, logger));
    },
    async stop() {
      const currentSubscription = subscription;
      subscription = undefined;
      await currentSubscription?.close();
    },
  };
}

function createHandlers(
  options: CreateMonitorOptions,
  emit: (event: MonitorEvent) => void,
  logger: MonitorLogger,
): MonitorSourceHandlers {
  return {
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

      logger.log(`[${event.timestamp.toISOString()}] ${text}`);
    },
    onIncomeDanmu(event) {
      // 空内容（部分弹幕只有表情或被过滤）不入事件流，避免下游写出空记录
      if (event.content) {
        emit({
          type: "danmu.received",
          roomId: options.roomId,
          streamer: options.streamer,
          content: event.content,
          userId: event.userId,
          username: event.username,
          timestamp: event.timestamp,
        });
      }

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
      logger.log(`[${event.timestamp.toISOString()}] ${text}`);
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
  };
}

function renderMessage(template: string, options: MonitorFeatureOptions): string {
  return template
    .replaceAll("{uname}", options.streamer)
    .replaceAll("{roomId}", String(options.roomId));
}

const consoleLogger: MonitorLogger = {
  log: console.log,
  error: console.error,
};
