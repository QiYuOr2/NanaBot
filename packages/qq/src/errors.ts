export class QQSendError extends Error {
  readonly code?: string | number;

  constructor(message: string, options: { code?: string | number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "QQSendError";
    this.code = options.code;
  }
}

export function toQQSendError(error: unknown): QQSendError {
  if (error instanceof QQSendError) return error;
  const code = error && typeof error === "object" && "bizCode" in error ? error.bizCode : undefined;
  return new QQSendError(error instanceof Error ? error.message : "官方 QQ 消息发送失败", {
    code: typeof code === "number" || typeof code === "string" ? code : undefined,
    cause: error,
  });
}
