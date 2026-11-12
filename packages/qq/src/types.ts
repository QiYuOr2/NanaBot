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
  | { type: "image"; source: QQImageSource };

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

export interface QQClientEvents {
  connected: [];
  disconnected: [event: QQDisconnection];
  groupDiscovered: [group: QQDiscoveredGroup];
  error: [error: Error];
}

export type QQEventListener<T extends keyof QQClientEvents> = (...args: QQClientEvents[T]) => void;

/** 发送目标始终是官方 group_openid；本地群号映射和业务日志由调用方处理。 */
export interface QQClientPort {
  on<T extends keyof QQClientEvents>(event: T, listener: QQEventListener<T>): () => void;
  /** 持续运行到 stop/abort，启动失败或不可恢复错误时拒绝。 */
  start(signal?: AbortSignal): Promise<void>;
  stop(): void;
  sendGroupMessage(groupOpenid: string, parts: readonly QQMessagePart[]): Promise<QQSentMessage>;
}
