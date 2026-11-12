export type QQSendErrorKind =
  | "platform_unavailable"
  | "reply_context_missing"
  | "reply_expired"
  | "permission_or_limit"
  | "unsupported_content"
  | "unknown";

export class QQSendError extends Error {
  readonly code?: string | number;
  readonly kind: QQSendErrorKind;

  constructor(
    message: string,
    options: { code?: string | number; cause?: unknown; kind?: QQSendErrorKind } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "QQSendError";
    this.code = options.code;
    this.kind = options.kind ?? classifyQQSendError(message);
  }
}

export function toQQSendError(error: unknown): QQSendError {
  if (error instanceof QQSendError) return error;
  const code = error && typeof error === "object" && "bizCode" in error ? error.bizCode : undefined;
  const message = error instanceof Error ? error.message : "官方 QQ 消息发送失败";
  return new QQSendError(error instanceof Error ? error.message : "官方 QQ 消息发送失败", {
    code: typeof code === "number" || typeof code === "string" ? code : undefined,
    kind: classifyQQSendError(message, typeof code === "number" ? code : undefined),
    cause: error,
  });
}

function classifyQQSendError(message: string, code?: number): QQSendErrorKind {
  if (code === 304023 || code === 304024 || /expired|过期|msg_id|passive/i.test(message))
    return "reply_expired";
  if (/permission|权限|次数|limit|限/i.test(message)) return "permission_or_limit";
  if (/unsupported|不支持|empty|内容为空/i.test(message)) return "unsupported_content";
  if (/connect|network|timeout|unavailable|未连接|连接/i.test(message))
    return "platform_unavailable";
  return "unknown";
}
