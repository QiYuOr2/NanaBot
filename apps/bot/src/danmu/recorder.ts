import type { MonitorEvent, MonitorSink } from "@nana/monitor";
import { closeDanmuSession, findActiveDanmuSession, openDanmuSession } from "@nana/storage";
import type { DanmuSession, StorageOptions } from "@nana/storage";
import { consoleLogger, type Logger } from "../core/logger.ts";
import type { WordCloudConfig } from "./config.ts";
import { publishWordCloud } from "./publish.ts";
import { DanmuStore, FLUSH_INTERVAL_MS } from "./store.ts";
import type { DanmuCloseReason, WordCloudSender } from "./types.ts";

export interface DanmuRecorderOptions extends StorageOptions {
  roomId: number;
  streamer: string;
  config: WordCloudConfig;
  /** 该主播的词云推送目标群；空数组表示只落库不推送。 */
  notifyGroupIds: number[];
  /** 是否在收尾时推送词云，停机收尾与轮询兜底复用同一实现。 */
  pushOnEnd?: boolean;
  sendWordCloud: WordCloudSender;
  /** 场次落库之后调用。词云推送失败时仍会调用。 */
  onClosed?: (sessionId: number, closeReason: DanmuCloseReason) => Promise<void>;
  /** 时钟注入点，便于测试。 */
  now?: () => Date;
  /** 当前账号的日志出口。 */
  logger?: Logger;
}

/**
 * 单场弹幕录制器：开播开录、下播收尾、生成词云并推送到该主播配置的群。
 *
 * 弹幕走 {@link DanmuStore} 的批量队列落库；进程重启后若上一场还没结束，
 * 会接着同一场次记录，不把一场直播拆成多段。
 */
export class DanmuRecorder {
  private readonly options: DanmuRecorderOptions;
  private readonly now: () => Date;
  private readonly store: DanmuStore;
  private readonly logger: Logger;
  private readonly storage: StorageOptions;
  private session: DanmuSession | undefined;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  /** 正在生成 / 推送词云，避免重复触发。 */
  private finishing = false;

  constructor(options: DanmuRecorderOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.storage = { rootDir: options.rootDir };
    this.logger = options.logger ?? consoleLogger;
    this.store = new DanmuStore(() => this.session?.id, this.storage, this.logger);
  }

  /** 当前是否有正在录制的场次。 */
  get active(): boolean {
    return this.session !== undefined;
  }

  /** 该录制器负责的直播间号。 */
  get roomId(): number {
    return this.options.roomId;
  }

  /** 当前场次 id；未在录制时为 undefined。 */
  get sessionId(): number | undefined {
    return this.session?.id;
  }

  /** 开播：开启一场新录制；重复调用幂等，重连 / 重启后接着同一场次。 */
  start(timestamp?: Date): DanmuSession | undefined {
    if (this.session) {
      return this.session;
    }

    const resumed = findActiveDanmuSession(this.options.roomId, this.storage);
    this.session =
      resumed ??
      openDanmuSession(
        {
          roomId: this.options.roomId,
          streamer: this.options.streamer,
          startedAt: (timestamp ?? this.now()).toISOString(),
        },
        this.storage,
      );
    this.store.flush();
    this.flushTimer = setInterval(() => this.store.flush(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
    this.logger.info(
      `[弹幕录制] ${this.options.streamer} ${resumed ? "继续记录" : "开始记录"}弹幕（场次 #${this.session.id}）`,
    );

    return this.session;
  }

  /** 追加一条弹幕；未在录制时忽略。 */
  append(message: { userId: string; username: string; content: string; sentAt?: string }): void {
    if (!this.session) {
      return;
    }

    this.store.enqueue({
      userId: message.userId,
      username: message.username,
      content: message.content,
      sentAt: message.sentAt ?? this.now().toISOString(),
    });
  }

  /**
   * 收尾：停止录制、落库并推送本场词云。
   * `closeReason` 区分正常下播（`live.ended`）与兜底收尾（`poll` / `stale` / `shutdown`）。
   */
  async finish(closeReason: DanmuCloseReason = "live.ended", endedAt?: Date): Promise<void> {
    const session = this.session;
    if (!session || this.finishing) {
      return;
    }

    this.finishing = true;
    try {
      this.stopTimer();
      // 先显式把整场剩余的弹幕落到本场次，再清空 session，否则队列会因取不到场次 id 被丢弃。
      this.store.flush(session.id);
      this.session = undefined;
      closeDanmuSession(
        session.id,
        { endedAt: (endedAt ?? this.now()).toISOString(), reason: closeReason },
        this.storage,
      );
      this.logger.info(
        `[弹幕录制] ${this.options.streamer} 停止记录弹幕（场次 #${session.id}，原因 ${closeReason}）`,
      );

      if (this.options.pushOnEnd !== false) {
        try {
          await publishWordCloud({
            sessionId: session.id,
            streamer: this.options.streamer,
            config: this.options.config,
            notifyGroupIds: this.options.notifyGroupIds,
            sendWordCloud: this.options.sendWordCloud,
            closeReason,
            rootDir: this.options.rootDir,
            logger: this.logger,
          });
        } catch (error) {
          this.logger.error(`[弹幕录制] ${this.options.streamer} 词云推送失败`, error);
        }
      }

      try {
        await this.options.onClosed?.(session.id, closeReason);
      } catch (error) {
        this.logger.error(`[弹幕录制] ${this.options.streamer} 场次收尾回调失败`, error);
      }
    } finally {
      this.finishing = false;
    }
  }

  /** 进程退出：收尾当前场次并尽力推送，不抛出异常。 */
  async shutdown(): Promise<void> {
    try {
      await this.finish("shutdown");
    } catch (error) {
      this.logger.error("[弹幕录制] 停机收尾失败", error);
    }
  }

  private stopTimer(): void {
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}

/** 把直播监控事件转换成弹幕录制 / 收尾动作。 */
export function createDanmuSink(recorder: DanmuRecorder): MonitorSink {
  return {
    async handle(event: MonitorEvent) {
      switch (event.type) {
        case "live.started":
          recorder.start(event.timestamp);
          return;
        case "danmu.received":
          recorder.append({
            userId: String(event.userId),
            username: event.username,
            content: event.content,
            sentAt: event.timestamp.toISOString(),
          });
          return;
        case "live.ended":
          await recorder.finish("live.ended", event.timestamp);
          return;
        default:
          return;
      }
    },
  };
}
