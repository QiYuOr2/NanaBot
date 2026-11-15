import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { QQSendError, toQQSendError } from "./errors.ts";
import {
  encodeQQMessage,
  readSentMessage,
  stripInboundMentions,
  toSDKImageSource,
} from "./messages.ts";
import type {
  QQClientEvents,
  QQClientOptions,
  QQClientPort,
  QQEventListener,
  QQMessagePart,
  QQSentMessage,
  QQIncomingMessage,
} from "./types.ts";

/** 官方通信边界：不读取配置文件，不写数据库，也不依赖业务应用。 */
export class QQClient implements QQClientPort {
  private readonly bot: QQBot;
  private readonly listeners: { [T in keyof QQClientEvents]: Set<QQEventListener<T>> } = {
    connected: new Set(),
    disconnected: new Set(),
    groupDiscovered: new Set(),
    error: new Set(),
    message: new Set(),
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
      if (
        !this.running ||
        (message.kind !== "group" && message.kind !== "c2c") ||
        !message.replyTarget
      ) {
        return;
      }
      if (message.senderIsBot) return;
      const incoming: QQIncomingMessage = {
        id: message.messageId,
        eventType: message.rawEventType,
        kind: message.kind === "group" ? "group" : "private",
        content: stripInboundMentions(message.content),
        senderId: message.senderId,
        ...(message.senderName ? { senderName: message.senderName } : {}),
        ...(message.groupOpenid ? { groupOpenid: message.groupOpenid } : {}),
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
        isAtBot:
          message.kind === "group" &&
          (message.rawEventType === "GROUP_AT_MESSAGE_CREATE" ||
            message.mentions?.some((mention) => mention.is_you) === true),
        ...(message.raw && "event_id" in message.raw && typeof message.raw.event_id === "string"
          ? { eventId: message.raw.event_id }
          : {}),
        replyTarget: {
          scope: message.replyTarget.scope,
          targetId: message.replyTarget.targetId,
          msgId: message.messageId,
        },
      };
      if (incoming.groupOpenid)
        this.emit("groupDiscovered", { openid: incoming.groupOpenid, source: "message" });
      this.emit("message", incoming);
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

  /** 按 encode 后的形态分发：Markdown 走 msg_type=2，图片/语音走富媒体，其余纯文本。 */
  private async sendEncoded(
    target: { scope: "group" | "c2c"; targetId: string; msgId?: string },
    encoded: ReturnType<typeof encodeQQMessage>,
  ): Promise<QQSentMessage> {
    if (encoded.markdown !== undefined) {
      return readSentMessage(await this.bot.sendMarkdown(target, encoded.markdown));
    }
    if (encoded.voice !== undefined) {
      const result = await this.bot.sendVoice(target, toSDKImageSource(encoded.voice));
      return readSentMessage(result.message);
    }
    if (encoded.image !== undefined) {
      const result = await this.bot.sendImage(target, toSDKImageSource(encoded.image), {
        content: encoded.text,
      });
      return readSentMessage(result.message);
    }
    return readSentMessage(await this.bot.sendText(target, encoded.text));
  }

  async sendGroupMessage(
    groupOpenid: string,
    parts: readonly QQMessagePart[],
  ): Promise<QQSentMessage> {
    try {
      if (!groupOpenid.trim()) throw new QQSendError("官方 QQ 群 group_openid 不能为空。");
      return await this.sendEncoded(
        { scope: "group", targetId: groupOpenid },
        encodeQQMessage(parts),
      );
    } catch (error) {
      throw toQQSendError(error);
    }
  }

  async sendPrivateMessage(
    openid: string,
    parts: readonly QQMessagePart[],
  ): Promise<QQSentMessage> {
    try {
      if (!openid.trim()) throw new QQSendError("官方 QQ 用户 openid 不能为空。");
      return await this.sendEncoded({ scope: "c2c", targetId: openid }, encodeQQMessage(parts));
    } catch (error) {
      throw toQQSendError(error);
    }
  }

  async replyMessage(
    message: QQIncomingMessage,
    parts: readonly QQMessagePart[],
  ): Promise<QQSentMessage> {
    try {
      return await this.sendEncoded(message.replyTarget, encodeQQMessage(parts));
    } catch (error) {
      throw toQQSendError(error);
    }
  }

  async sendTyping(openid: string, durationSec = 10): Promise<void> {
    try {
      if (!openid.trim()) throw new QQSendError("官方 QQ 用户 openid 不能为空。");
      await this.bot.sendTyping({ scope: "c2c", targetId: openid }, durationSec);
    } catch (error) {
      throw toQQSendError(error);
    }
  }

  private emit<T extends keyof QQClientEvents>(event: T, ...args: QQClientEvents[T]): void {
    for (const listener of this.listeners[event]) {
      const result = listener(...args) as unknown;
      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch((error: unknown) => {
          if (this.running)
            this.emit("error", error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }
}
