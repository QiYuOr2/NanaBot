import { QQSendError } from "./errors.ts";
import type { QQImageSource, QQMessagePart, QQSentMessage } from "./types.ts";

const AT_ALL_MARKER = "<qqbot-at-everyone />";
const INBOUND_MENTION_PATTERN = /<@(?:all|[0-9A-Za-z_-]+)>/g;

/** 官方事件把 @ 用户编码成 `<@openid>`；命令与规则只应看到纯文本。 */
export function stripInboundMentions(content: string): string {
  return content.replaceAll(INBOUND_MENTION_PATTERN, " ").replace(/\s+/g, " ").trim();
}

export function encodeQQMessage(parts: readonly QQMessagePart[]) {
  let text = "";
  let image: QQImageSource | undefined;
  let markdown: string | undefined;
  let voice: QQImageSource | undefined;
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
      case "markdown":
        if (markdown !== undefined) throw new QQSendError("官方 QQ 单条消息仅支持一段 Markdown。");
        markdown = part.content;
        break;
      case "voice":
        if (voice !== undefined) throw new QQSendError("官方 QQ 单条消息仅支持一段语音。");
        voice = part.source;
        break;
      default:
        throw new QQSendError("不支持的官方 QQ 消息类型。");
    }
  }
  text = text.trim();
  if (voice !== undefined) {
    // 语音是独立的富媒体消息（file_type=3），不与文本、图片或 Markdown 合并。
    if (image !== undefined || markdown !== undefined || text)
      throw new QQSendError("官方 QQ 语音消息不能与文本、图片或 Markdown 合并发送。");
    return { text: "", image: undefined, markdown: undefined, voice };
  }
  if (markdown !== undefined) {
    // 官方规定：带 markdown 时 content 必须为空，且媒体消息不能与 Markdown 合并。
    if (image !== undefined || text)
      throw new QQSendError("官方 QQ Markdown 消息不能与文本或图片合并发送。");
    if (!markdown.trim()) throw new QQSendError("官方 QQ 消息内容为空。");
    return { text: "", image: undefined, markdown, voice: undefined };
  }
  if (image !== undefined && text.includes(AT_ALL_MARKER)) {
    throw new QQSendError("官方 QQ @全体成员仅支持文本或 Markdown，不能与图片媒体消息合并发送。");
  }
  if (image === undefined && !text) throw new QQSendError("官方 QQ 消息内容为空。");
  return { text, image, markdown: undefined, voice: undefined };
}

export function toSDKImageSource(source: QQImageSource): {
  url?: string;
  localPath?: string;
  buffer?: Buffer;
} {
  if (typeof source !== "string") return { buffer: Buffer.from(source) };
  if (/^https?:\/\//.test(source)) return { url: source };
  if (source.startsWith("base64://")) return { buffer: Buffer.from(source.slice(9), "base64") };
  return { localPath: source.startsWith("file://") ? new URL(source).pathname : source };
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
