import type { NapcatClientPort, NapcatIncomingEvent, NapcatMessagePart } from "@nana/napcat";
import type { QQClientPort, QQIncomingMessage, QQMessagePart } from "@nana/qq";
import type {
  IncomingMessage,
  MessagePlatformAdapter,
  MessageTarget,
  OutgoingMessage,
  PlatformConnectionState,
} from "./types.ts";

const OFFICIAL_TRACKED_MESSAGES = 10_000;

/** 业务层 OutgoingMessage → 官方 QQ 消息段。Markdown 独占整条消息，图片可带文本说明。 */
export function toOfficialParts(message: OutgoingMessage): QQMessagePart[] {
  if (message.markdown !== undefined) {
    if (message.image !== undefined) throw new Error("官方 QQ Markdown 消息不能同时携带图片。");
    return [{ type: "markdown", content: message.markdown }];
  }
  const parts: QQMessagePart[] = [];
  if (message.text) parts.push({ type: "text", text: message.text });
  if (message.image !== undefined) parts.push({ type: "image", source: message.image });
  if (parts.length === 0) parts.push({ type: "text", text: message.text });
  return parts;
}

/** 业务层 OutgoingMessage → NapCat 消息段。NapCat 不支持 Markdown。 */
export function toNapcatParts(message: OutgoingMessage): NapcatMessagePart[] {
  if (message.markdown !== undefined) throw new Error("NapCat 不支持 Markdown 消息。");
  const parts: NapcatMessagePart[] = [];
  if (message.text) parts.push({ type: "text", text: message.text });
  if (message.image !== undefined) parts.push({ type: "image", source: message.image });
  if (parts.length === 0) parts.push({ type: "text", text: message.text });
  return parts;
}

function officialReplyPolicy(message: IncomingMessage) {
  const context = message.replyContext;
  if (context.platform !== "official") throw new Error("官方 QQ 回复上下文缺失。");
  const eventType = context.eventType;
  if (!eventType) throw new Error("官方 QQ 缺少入站事件类型，拒绝按未知场景被动回复。");
  const isPassiveGroup =
    message.scene === "group" &&
    (eventType === "GROUP_AT_MESSAGE_CREATE" || eventType === "GROUP_MESSAGE_CREATE");
  const isPassiveC2C = message.scene === "private" && eventType === "C2C_MESSAGE_CREATE";
  if (!isPassiveGroup && !isPassiveC2C)
    throw new Error("官方 QQ 入站事件类型不支持被动回复，拒绝按主动消息发送。");
  return {
    windowMs: isPassiveGroup ? 5 * 60_000 : 60 * 60_000,
    limit: isPassiveGroup ? 5 : 4,
  };
}

export function normalizeNapcatMessage(
  event: NapcatIncomingEvent,
  accountId: string,
): IncomingMessage | undefined {
  const conversationId = event.messageType === "group" ? event.groupId : event.userId;
  if (!event.text.trim() || !conversationId) return undefined;
  return {
    id: event.messageId,
    accountId,
    platform: "napcat",
    scene: event.messageType,
    conversationId,
    senderId: event.userId,
    ...(event.senderName ? { senderName: event.senderName } : {}),
    text: event.text,
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    isAtBot: event.isAtBot,
    replyContext: {
      platform: "napcat",
      messageId: event.messageId,
      ...(event.groupId ? { groupId: event.groupId } : {}),
      userId: event.userId,
    },
  };
}

export function normalizeOfficialMessage(
  message: QQIncomingMessage,
  accountId: string,
): IncomingMessage {
  const parsedTimestamp = message.timestamp ? Date.parse(message.timestamp) : Number.NaN;
  return {
    id: message.id,
    accountId,
    platform: "official",
    scene: message.kind,
    conversationId: message.replyTarget.targetId,
    senderId: message.senderId,
    ...(message.senderName ? { senderName: message.senderName } : {}),
    text: message.content,
    ...(Number.isFinite(parsedTimestamp) ? { timestamp: parsedTimestamp } : {}),
    isAtBot: message.isAtBot,
    replyContext: {
      platform: "official",
      messageId: message.replyTarget.msgId,
      ...(message.eventId ? { eventId: message.eventId } : {}),
      ...(message.eventType ? { eventType: message.eventType } : {}),
      scene: message.kind,
      ...(message.kind === "group"
        ? { groupOpenId: message.replyTarget.targetId }
        : { userOpenId: message.replyTarget.targetId }),
    },
  };
}

export class NapcatMessageAdapter implements MessagePlatformAdapter {
  readonly platform = "napcat" as const;
  readonly accountId: string;
  private readonly client: NapcatClientPort;

  constructor(client: NapcatClientPort, accountId: string) {
    this.client = client;
    this.accountId = accountId;
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  onMessage(handler: (message: IncomingMessage) => void | Promise<void>): () => void {
    return this.client.onMessage((event) => {
      const message = normalizeNapcatMessage(event, this.accountId);
      if (message) return handler(message);
    });
  }

  onConnectionState(handler: (state: PlatformConnectionState) => void): () => void {
    return this.client.onConnectionState((state) => handler({ ...state, platform: this.platform }));
  }

  onHeartbeat(handler: (online: boolean) => void): () => void {
    return this.client.onHeartbeat(handler);
  }

  async reply(message: IncomingMessage, response: OutgoingMessage): Promise<void> {
    const context = message.replyContext;
    if (message.accountId !== this.accountId || context.platform !== "napcat")
      throw new Error("NapCat 消息回复上下文与当前账号不匹配。");
    await this.client.reply(
      {
        messageId: context.messageId,
        messageType: message.scene,
        ...(context.groupId ? { groupId: context.groupId } : {}),
        userId: context.userId,
        text: message.text,
        isAtBot: message.isAtBot,
      },
      toNapcatParts(response),
    );
  }

  async send(target: MessageTarget, message: OutgoingMessage): Promise<void> {
    if (target.accountId !== this.accountId || target.platform !== this.platform)
      throw new Error("NapCat 发送目标与当前账号不匹配。");
    const parts = toNapcatParts(message);
    if (target.scene === "group") await this.client.sendGroupMessage(target.conversationId, parts);
    else await this.client.sendPrivateMessage(target.conversationId, parts);
  }

  async sendTyping(_target: MessageTarget, _durationSec: number): Promise<void> {
    throw new Error("NapCat 不支持输入中状态。");
  }
}

interface TrackedOfficialReply {
  receivedAt: number;
  count: number;
  inFlight: number;
  lock: Promise<void>;
  eventType?: string;
}

export class OfficialMessageAdapter implements MessagePlatformAdapter {
  readonly platform = "official" as const;
  readonly accountId: string;
  private readonly client: QQClientPort;
  private readonly messageHandlers = new Set<(message: IncomingMessage) => void | Promise<void>>();
  private readonly stateHandlers = new Set<(state: PlatformConnectionState) => void>();
  private readonly replies = new Map<string, TrackedOfficialReply>();
  private readonly subscriptions: (() => void)[] = [];
  private acceptingMessages = true;
  private readonly now: () => number;
  private readonly logger?: {
    warn: (message: string, error?: unknown) => void;
    error: (message: string, error?: unknown) => void;
  };

  constructor(
    client: QQClientPort,
    accountId: string,
    options: {
      now?: () => number;
      logger?: {
        warn: (message: string, error?: unknown) => void;
        error: (message: string, error?: unknown) => void;
      };
    } = {},
  ) {
    this.client = client;
    this.accountId = accountId;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger;
    this.subscriptions.push(
      this.client.on("message", (incoming) => {
        if (!this.acceptingMessages) return;
        this.track(incoming);
        this.dispatch(normalizeOfficialMessage(incoming, this.accountId));
      }),
      this.client.on("connected", () => this.emitState({ connected: true, phase: "connected" })),
      this.client.on("disconnected", () =>
        this.emitState({ connected: false, phase: "disconnected" }),
      ),
      this.client.on("error", (error) =>
        this.logger?.error(`[官方 QQ] ${this.accountId} 消息适配器错误`, error),
      ),
    );
  }

  async start(signal?: AbortSignal): Promise<void> {
    return this.client.start(signal);
  }

  async stop(): Promise<void> {
    this.acceptingMessages = false;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.messageHandlers.clear();
    this.stateHandlers.clear();
    this.replies.clear();
    this.client.stop();
  }

  onMessage(handler: (message: IncomingMessage) => void | Promise<void>): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionState(handler: (state: PlatformConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  async reply(message: IncomingMessage, response: OutgoingMessage): Promise<void> {
    if (
      message.accountId !== this.accountId ||
      message.platform !== this.platform ||
      message.replyContext.platform !== this.platform
    )
      throw new Error("官方 QQ 回复上下文与当前账号不匹配。");
    const tracked = this.replies.get(message.id);
    if (!tracked) throw new Error("官方 QQ 原消息未由当前账号接收。");
    const policy = officialReplyPolicy(message);
    if (this.now() - tracked.receivedAt > policy.windowMs) {
      this.replies.delete(message.id);
      throw new Error("官方 QQ 被动回复已超过有效期，不改用主动消息发送。");
    }
    const context = officialReplyContext(message);
    if (tracked.count + tracked.inFlight >= policy.limit)
      throw new Error("官方 QQ 原消息的被动回复次数已达上限，不改用主动消息发送。");
    tracked.inFlight += 1;
    const previous = tracked.lock;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tracked.lock = previous.then(() => current);
    try {
      await previous;
      const latest = this.replies.get(message.id);
      if (!latest || latest.count + latest.inFlight - 1 >= policy.limit)
        throw new Error("官方 QQ 原消息的被动回复次数已达上限，不改用主动消息发送。");
      await this.client.replyMessage(context, toOfficialParts(response));
      latest.count += 1;
    } finally {
      release();
      tracked.inFlight -= 1;
      if (tracked.inFlight === 0) tracked.lock = Promise.resolve();
    }
  }

  async send(target: MessageTarget, message: OutgoingMessage): Promise<void> {
    if (target.accountId !== this.accountId || target.platform !== this.platform)
      throw new Error("官方 QQ 发送目标与当前账号不匹配。");
    const parts = toOfficialParts(message);
    if (target.scene === "group") await this.client.sendGroupMessage(target.conversationId, parts);
    else await this.client.sendPrivateMessage(target.conversationId, parts);
  }

  async sendTyping(target: MessageTarget, durationSec: number): Promise<void> {
    if (target.accountId !== this.accountId || target.platform !== this.platform)
      throw new Error("官方 QQ 发送目标与当前账号不匹配。");
    if (target.scene !== "private") throw new Error("官方 QQ 输入中状态仅支持私聊。");
    if (!this.client.sendTyping) throw new Error("官方 QQ 客户端未提供输入中状态。");
    await this.client.sendTyping(target.conversationId, durationSec);
  }

  private track(incoming: QQIncomingMessage): void {
    this.replies.set(incoming.id, {
      receivedAt: this.now(),
      count: 0,
      inFlight: 0,
      lock: Promise.resolve(),
      ...(incoming.eventType ? { eventType: incoming.eventType } : {}),
    });
    if (this.replies.size <= OFFICIAL_TRACKED_MESSAGES) return;
    const oldest = this.replies.keys().next().value;
    if (oldest === undefined) return;
    const tracked = this.replies.get(oldest);
    if (!tracked || tracked.inFlight === 0) this.replies.delete(oldest);
  }

  private dispatch(message: IncomingMessage): void {
    for (const handler of this.messageHandlers) {
      Promise.resolve(handler(message)).catch((error) =>
        this.logger?.error(
          `[message] 官方 QQ ${this.accountId} 消息处理失败 id=${message.id}`,
          error,
        ),
      );
    }
  }

  private emitState(state: PlatformConnectionState): void {
    for (const handler of this.stateHandlers) handler({ ...state, platform: this.platform });
  }
}

function officialReplyContext(message: IncomingMessage): QQIncomingMessage {
  const context = message.replyContext;
  if (context.platform !== "official") throw new Error("官方 QQ 回复上下文缺失。");
  const targetId = context.scene === "group" ? context.groupOpenId : context.userOpenId;
  if (!targetId || context.messageId !== message.id || targetId !== message.conversationId)
    throw new Error("官方 QQ 回复上下文消息或会话不匹配。");
  return {
    id: message.id,
    kind: message.scene,
    content: message.text,
    senderId: message.senderId,
    ...(message.senderName ? { senderName: message.senderName } : {}),
    isAtBot: message.isAtBot,
    replyTarget: {
      scope: context.scene === "group" ? "group" : "c2c",
      targetId,
      msgId: context.messageId,
    },
  };
}
