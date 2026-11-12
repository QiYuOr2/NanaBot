export type MessagePlatform = "napcat" | "official";
export type MessageScene = "group" | "private";

export type MessageReplyContext =
  | { platform: "napcat"; messageId: string; groupId?: string; userId: string }
  | {
      platform: "official";
      messageId: string;
      eventId?: string;
      eventType?: string;
      scene: MessageScene;
      groupOpenId?: string;
      userOpenId?: string;
    };

export interface IncomingMessage {
  id: string;
  accountId: string;
  platform: MessagePlatform;
  scene: MessageScene;
  conversationId: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp?: number;
  isAtBot: boolean;
  replyContext: MessageReplyContext;
}

export interface OutgoingMessage {
  text: string;
}
export type MessageReply = OutgoingMessage;

export interface MessageTarget {
  platform: MessagePlatform;
  accountId: string;
  scene: MessageScene;
  conversationId: string;
}

export interface PlatformConnectionState {
  connected: boolean;
  phase?: "connecting" | "connected" | "disconnected";
  platform?: MessagePlatform;
  reconnectAttempts?: number;
}

export interface MessagePlatformAdapter {
  readonly platform: MessagePlatform;
  readonly accountId: string;
  start(signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: IncomingMessage) => void | Promise<void>): () => void;
  onConnectionState(handler: (state: PlatformConnectionState) => void): () => void;
  reply(message: IncomingMessage, response: OutgoingMessage): Promise<void>;
  send(target: MessageTarget, message: OutgoingMessage): Promise<void>;
}

export interface MessageRule {
  id: string;
  enabled: boolean;
  type: "exact" | "contains" | "startsWith" | "regex";
  pattern: string;
  ignoreCase: boolean;
  response: string | string[];
}

export interface MessageConfig {
  enabled: boolean;
  commands: { enabled: boolean; prefix: string; aliases: Record<string, string> };
  rules: { enabled: boolean; items: MessageRule[]; stopOnFirstMatch: boolean };
  admins: { users: string[]; groups: string[] };
  scopes: {
    group: { enabled: boolean; allow: string[]; deny: string[] };
    private: { enabled: boolean; allow: string[]; deny: string[] };
  };
  cooldown: {
    enabled: boolean;
    commandUserMs: number;
    ruleUserMs: number;
    ruleConversationMs: number;
  };
}

export interface MessageRuntime {
  accountId: string;
  accountName: string;
  provider: MessagePlatform;
  connected: () => boolean;
  configuredStreamers: number;
  configuredAccounts: number;
  connectedAccounts: () => number;
  startedAt: number;
  rootDir: string;
  roomIds: number[];
}
