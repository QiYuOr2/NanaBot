import { fileURLToPath } from "node:url";
import { QQSendError } from "./errors.ts";
import type { QQImageSource, QQMessagePart, QQSentMessage } from "./types.ts";

const AT_ALL_MARKER = "<qqbot-at-everyone />";

export function encodeQQMessage(parts: readonly QQMessagePart[]) {
  let text = "";
  let image: QQImageSource | undefined;
  for (const part of parts) {
    switch (part.type) {
      case "text":
        text += part.text;
        break;
      case "atAll":
        if (!text.includes(AT_ALL_MARKER)) text += AT_ALL_MARKER;
        break;
      case "image":
        if (image !== undefined) throw new QQSendError("官方 QQ 单条消息仅支持一张图片。");
        image = part.source;
        break;
      default:
        throw new QQSendError("不支持的官方 QQ 消息类型。");
    }
  }
  text = text.trim();
  if (image !== undefined && text.includes(AT_ALL_MARKER)) {
    throw new QQSendError("官方 QQ @全体成员仅支持文本或 Markdown，不能与图片媒体消息合并发送。");
  }
  if (image === undefined && !text) throw new QQSendError("官方 QQ 消息内容为空。");
  return { text, image };
}

export function toSDKImageSource(source: QQImageSource): {
  url?: string;
  localPath?: string;
  buffer?: Buffer;
} {
  if (typeof source !== "string") return { buffer: Buffer.from(source) };
  if (/^https?:\/\//.test(source)) return { url: source };
  if (source.startsWith("base64://")) return { buffer: Buffer.from(source.slice(9), "base64") };
  return { localPath: source.startsWith("file://") ? fileURLToPath(source) : source };
}

/** SDK 对 HTTP 200 的业务失败不作校验，只有返回消息 ID 才视为已发送。 */
export function readSentMessage(result: unknown): QQSentMessage {
  const response = result as
    | { id?: unknown; timestamp?: unknown; code?: unknown; err_code?: unknown; message?: unknown }
    | undefined;
  const code = response?.code ?? response?.err_code;
  if (code !== undefined && code !== 0 && code !== "0") {
    const codeLabel = typeof code === "number" || typeof code === "string" ? code : "未知错误";
    throw new QQSendError(
      `官方 QQ 发送失败（${codeLabel}）：${typeof response?.message === "string" ? response.message : "平台拒绝消息"}`,
      {
        code: typeof code === "number" || typeof code === "string" ? code : undefined,
      },
    );
  }
  if (!response || typeof response.id !== "string" || !response.id)
    throw new QQSendError("官方 QQ 未返回消息 ID，无法确认消息已发送。");
  return {
    id: response.id,
    ...(typeof response.timestamp === "number" || typeof response.timestamp === "string"
      ? { timestamp: response.timestamp }
      : {}),
  };
}
