export interface NapcatLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  debug?(message: string, details?: unknown): void;
}

export type NapcatMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; source: string | Uint8Array }
  | { type: "atAll" };

export interface NapcatIncomingEvent {
  messageId: string;
  messageType: "group" | "private";
  groupId?: string;
  userId: string;
  senderName?: string;
  text: string;
  timestamp?: number;
  isAtBot: boolean;
}

export interface NapcatConnectionState {
  connected: boolean;
  phase: "connecting" | "connected" | "disconnected";
  platform?: "napcat";
  reconnectAttempts?: number;
}

export interface NapcatSentMessage {
  messageId: string;
}

export interface NapcatGroupInfo {
  groupId: string;
  groupName: string;
}

export interface NapcatClientOptions {
  url: string;
  accessToken?: string;
  accountId: string;
  logger?: NapcatLogger;
  debug?: boolean;
  reconnect?: boolean;
}

export interface NapcatClientPort {
  readonly accountId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  reconnect(): Promise<void>;
  getStatus(): Promise<unknown>;
  onMessage(handler: (event: NapcatIncomingEvent) => void | Promise<void>): () => void;
  onConnectionState(handler: (state: NapcatConnectionState) => void): () => void;
  onHeartbeat(handler: (online: boolean) => void): () => void;
  onSocketError(handler: (event: NapcatSocketError) => void): () => void;
  sendGroupMessage(
    groupId: string,
    message: readonly NapcatMessagePart[],
  ): Promise<NapcatSentMessage>;
  sendPrivateMessage(
    userId: string,
    message: readonly NapcatMessagePart[],
  ): Promise<NapcatSentMessage>;
  reply(
    event: NapcatIncomingEvent,
    message: readonly NapcatMessagePart[],
  ): Promise<NapcatSentMessage>;
  getGroupInfo(groupId: string): Promise<NapcatGroupInfo>;
}

export interface NapcatSocketError {
  errorType: "response_error" | "connect_error";
  reconnectEnabled: boolean;
}
