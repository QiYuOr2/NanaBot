export interface QQCredentials {
  appId: string;
  appSecret: string;
}

export interface QQLogger {
  info(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  warn?(message: string, details?: unknown): void;
  debug?(message: string, details?: unknown): void;
}

export interface QQClientOptions extends QQCredentials {
  accountId?: string;
  sandbox?: boolean;
  logger?: QQLogger;
}

/** 字符串可为本地路径、file://、https:// 或 base64://；字节可直接传入。 */
export type QQImageSource = string | Uint8Array;
export type QQMessagePart =
  | { type: "text"; text: string }
  | { type: "atAll" }
  | { type: "image"; source: QQImageSource }
  | { type: "markdown"; content: string }
  | { type: "voice"; source: QQImageSource };

export interface QQSentMessage {
  id: string;
  timestamp?: string | number;
}

export interface QQDisconnection {
  code: number;
  reason?: string;
  willReconnect: boolean;
}

export interface QQDiscoveredGroup {
  openid: string;
  source: "message" | "added";
}

export interface QQIncomingMessage {
  id: string;
  kind: "group" | "private";
  eventType?: string;
  content: string;
  senderId: string;
  senderName?: string;
  groupOpenid?: string;
  timestamp?: string;
  eventId?: string;
  isAtBot: boolean;
  replyTarget: { scope: "group" | "c2c"; targetId: string; msgId: string };
}

export interface QQClientEvents {
  connected: [];
  disconnected: [event: QQDisconnection];
  groupDiscovered: [group: QQDiscoveredGroup];
  error: [error: Error];
  message: [message: QQIncomingMessage];
}

export type QQEventListener<T extends keyof QQClientEvents> = (
  ...args: QQClientEvents[T]
) => void | Promise<void>;

/** 发送目标始终是官方 group_openid；本地群号映射和业务日志由调用方处理。 */
export interface QQClientPort {
  on<T extends keyof QQClientEvents>(event: T, listener: QQEventListener<T>): () => void;
  /** 持续运行到 stop/abort，启动失败或不可恢复错误时拒绝。 */
  start(signal?: AbortSignal): Promise<void>;
  stop(): void;
  sendGroupMessage(groupOpenid: string, parts: readonly QQMessagePart[]): Promise<QQSentMessage>;
  sendPrivateMessage(openid: string, parts: readonly QQMessagePart[]): Promise<QQSentMessage>;
  replyMessage(message: QQIncomingMessage, parts: readonly QQMessagePart[]): Promise<QQSentMessage>;
  /** C2C「输入中」状态（官方 msg_type=6）；不支持的通道可以不实现。 */
  sendTyping?(openid: string, durationSec?: number): Promise<void>;
}
