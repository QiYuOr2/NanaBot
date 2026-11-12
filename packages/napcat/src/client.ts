import {
  NCWebsocket,
  Structs,
  type GroupMessage,
  type PrivateFriendMessage,
  type PrivateGroupMessage,
} from "node-napcat-ts";
import { toNapcatError } from "./errors.ts";
import { hasAtBot, readIncomingText, requireNumericId, toNapcatSegments } from "./messages.ts";
import type {
  NapcatClientOptions,
  NapcatClientPort,
  NapcatConnectionState,
  NapcatGroupInfo,
  NapcatIncomingEvent,
  NapcatMessagePart,
  NapcatSocketError,
  NapcatSentMessage,
} from "./types.ts";

export class NapcatClient implements NapcatClientPort {
  readonly accountId: string;
  private readonly socket: NCWebsocket;
  private readonly messages = new Set<(event: NapcatIncomingEvent) => void | Promise<void>>();
  private readonly states = new Set<(state: NapcatConnectionState) => void>();
  private readonly heartbeats = new Set<(online: boolean) => void>();
  private readonly socketErrors = new Set<(event: NapcatSocketError) => void>();
  private readonly subscriptions: (() => void)[] = [];
  private stopped = false;

  constructor(options: NapcatClientOptions) {
    this.accountId = options.accountId;
    this.socket = new NCWebsocket(
      {
        baseUrl: options.url,
        accessToken: options.accessToken,
        reconnection: {
          enable: options.reconnect ?? true,
          attempts: Number.POSITIVE_INFINITY,
          delay: 5000,
        },
      },
      options.debug,
    );
    this.subscriptions.push(
      this.socket.subscribe("message", (event) => this.receive(event)),
      this.socket.subscribe("socket.connecting", () =>
        this.emitState({ connected: false, phase: "connecting" }),
      ),
      this.socket.subscribe("socket.open", () =>
        this.emitState({ connected: true, phase: "connected" }),
      ),
      this.socket.subscribe("socket.close", (event) =>
        this.emitState({
          connected: false,
          phase: "disconnected",
          reconnectAttempts: event.reconnection.nowAttempts,
        }),
      ),
      this.socket.subscribe("socket.error", (event) => {
        const normalized: NapcatSocketError = {
          errorType: event.error_type,
          reconnectEnabled: event.reconnection.enable,
        };
        for (const handler of this.socketErrors) handler(normalized);
      }),
      this.socket.subscribe("meta_event.heartbeat", (event) => {
        const online = event.status.online !== false;
        for (const handler of this.heartbeats) handler(online);
      }),
    );
  }

  async start(): Promise<void> {
    this.stopped = false;
    try {
      await this.socket.connect();
    } catch (error) {
      throw toNapcatError(error, "连接");
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.messages.clear();
    this.states.clear();
    this.heartbeats.clear();
    this.socketErrors.clear();
    await this.socket.disconnect();
  }

  reconnect(): Promise<void> {
    return this.socket.reconnect();
  }

  getStatus(): Promise<unknown> {
    return this.socket.get_status();
  }

  onMessage(handler: (event: NapcatIncomingEvent) => void | Promise<void>): () => void {
    this.messages.add(handler);
    return () => this.messages.delete(handler);
  }

  onConnectionState(handler: (state: NapcatConnectionState) => void): () => void {
    this.states.add(handler);
    return () => this.states.delete(handler);
  }

  onHeartbeat(handler: (online: boolean) => void): () => void {
    this.heartbeats.add(handler);
    return () => this.heartbeats.delete(handler);
  }

  onSocketError(handler: (event: NapcatSocketError) => void): () => void {
    this.socketErrors.add(handler);
    return () => this.socketErrors.delete(handler);
  }

  async sendGroupMessage(
    groupId: string,
    message: readonly NapcatMessagePart[],
  ): Promise<NapcatSentMessage> {
    return this.send("群消息", () =>
      this.socket.send_group_msg({
        group_id: requireNumericId(groupId, "群 ID"),
        message: toNapcatSegments(message),
      }),
    );
  }

  async sendPrivateMessage(
    userId: string,
    message: readonly NapcatMessagePart[],
  ): Promise<NapcatSentMessage> {
    return this.send("私聊消息", () =>
      this.socket.send_private_msg({
        user_id: requireNumericId(userId, "用户 ID"),
        message: toNapcatSegments(message),
      }),
    );
  }

  async reply(
    event: NapcatIncomingEvent,
    message: readonly NapcatMessagePart[],
  ): Promise<NapcatSentMessage> {
    const quoted = [Structs.reply(event.messageId), ...toNapcatSegments(message)];
    if (event.messageType === "group") {
      if (!event.groupId) throw toNapcatError(new Error("缺少群 ID"), "回复");
      return this.send("群回复", () =>
        this.socket.send_group_msg({
          group_id: requireNumericId(event.groupId!, "群 ID"),
          message: quoted,
        }),
      );
    }
    return this.send("私聊回复", () =>
      this.socket.send_private_msg({
        user_id: requireNumericId(event.userId, "用户 ID"),
        message: quoted,
      }),
    );
  }

  async getGroupInfo(groupId: string): Promise<NapcatGroupInfo> {
    try {
      const info = await this.socket.get_group_info({
        group_id: requireNumericId(groupId, "群 ID"),
      });
      return { groupId: String(info.group_id), groupName: info.group_name };
    } catch (error) {
      throw toNapcatError(error, "查询群信息");
    }
  }

  private receive(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage): void {
    if (this.stopped || event.post_type !== "message" || event.user_id === event.self_id) return;
    const { text } = readIncomingText(event.message);
    const incoming: NapcatIncomingEvent = {
      messageId: String(event.message_id),
      messageType: event.message_type,
      ...(event.message_type === "group" ? { groupId: String(event.group_id) } : {}),
      userId: String(event.user_id),
      ...(event.sender.card || event.sender.nickname
        ? { senderName: event.sender.card || event.sender.nickname }
        : {}),
      text,
      timestamp: event.time * 1000,
      isAtBot: hasAtBot(event.message, event.self_id),
    };
    for (const handler of this.messages)
      void Promise.resolve(handler(incoming)).catch(() => undefined);
  }

  private emitState(state: NapcatConnectionState): void {
    if (!this.stopped) for (const handler of this.states) handler({ ...state, platform: "napcat" });
  }

  private async send(
    label: string,
    task: () => Promise<{ message_id: number }>,
  ): Promise<NapcatSentMessage> {
    try {
      const result = await task();
      return { messageId: String(result.message_id) };
    } catch (error) {
      throw toNapcatError(error, label);
    }
  }
}
