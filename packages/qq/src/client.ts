import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { QQSendError, toQQSendError } from "./errors.ts";
import { encodeQQMessage, readSentMessage, toSDKImageSource } from "./messages.ts";
import type {
  QQClientEvents,
  QQClientOptions,
  QQClientPort,
  QQEventListener,
  QQMessagePart,
  QQSentMessage,
} from "./types.ts";

/** 官方通信边界：不读取配置文件，不写数据库，也不依赖业务应用。 */
export class QQClient implements QQClientPort {
  private readonly bot: QQBot;
  private readonly listeners: { [T in keyof QQClientEvents]: Set<QQEventListener<T>> } = {
    connected: new Set(),
    disconnected: new Set(),
    groupDiscovered: new Set(),
    error: new Set(),
  };
  private running = false;
  private runId = 0;

  constructor(options: QQClientOptions) {
    this.bot = new QQBot({
      appId: options.appId,
      appSecret: options.appSecret,
      accountId: options.accountId,
      logger: options.logger,
      intents: 1 << 25,
      markdownSupport: false,
      ...(options.sandbox ? { baseUrl: "https://sandbox.api.sgroup.qq.com" } : {}),
    });
    const connected = () => {
      if (this.running) this.emit("connected");
    };
    this.bot.on("ready", connected);
    this.bot.on("resumed", connected);
    this.bot.on("disconnected", (event) => {
      if (this.running) this.emit("disconnected", event);
    });
    this.bot.on("error", (error) => {
      if (this.running) this.emit("error", error);
    });
    this.bot.on("message", (_context, message) => {
      if (this.running && message.kind === "group" && message.groupOpenid) {
        this.emit("groupDiscovered", { openid: message.groupOpenid, source: "message" });
      }
    });
    this.bot.on("rawEvent", (event) => {
      if (!this.running || event.eventType !== "GROUP_ADD_ROBOT") return;
      const data = event.data as { group_openid?: unknown };
      if (typeof data?.group_openid === "string")
        this.emit("groupDiscovered", { openid: data.group_openid, source: "added" });
    });
  }

  on<T extends keyof QQClientEvents>(event: T, listener: QQEventListener<T>): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.running) throw new Error("QQClient 已启动。");
    this.running = true;
    const runId = ++this.runId;
    try {
      await this.bot.start(signal);
    } finally {
      if (this.runId === runId) this.running = false;
    }
  }

  stop(): void {
    this.running = false;
    this.bot.stop();
  }

  async sendGroupMessage(
    groupOpenid: string,
    parts: readonly QQMessagePart[],
  ): Promise<QQSentMessage> {
    try {
      if (!groupOpenid.trim()) throw new QQSendError("官方 QQ 群 group_openid 不能为空。");
      const message = encodeQQMessage(parts);
      const target = { scope: "group" as const, targetId: groupOpenid };
      if (message.image !== undefined) {
        const result = await this.bot.sendImage(target, toSDKImageSource(message.image), {
          content: message.text,
        });
        return readSentMessage(result.message);
      }
      return readSentMessage(await this.bot.sendText(target, message.text));
    } catch (error) {
      throw toQQSendError(error);
    }
  }

  private emit<T extends keyof QQClientEvents>(event: T, ...args: QQClientEvents[T]): void {
    for (const listener of this.listeners[event]) listener(...args);
  }
}
