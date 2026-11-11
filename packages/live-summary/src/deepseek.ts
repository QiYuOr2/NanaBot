/** DeepSeek 对话补全接口。模型固定用 deepseek-chat。 */
export const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

export const DEEPSEEK_SUMMARY_MODEL = "deepseek-chat";

const REQUEST_TIMEOUT_MS = 90_000;

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

/** 调用 DeepSeek，返回助手消息正文。密钥错误和超时会抛出 {@link DeepSeekError}。 */
export async function requestDeepSeekChat(input: {
  apiKey: string;
  messages: readonly ChatMessage[];
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<string> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEPSEEK_SUMMARY_MODEL,
        messages: input.messages,
        temperature: 0.2,
        max_tokens: 512,
      }),
      signal,
    });
  } catch (error) {
    throw new DeepSeekError(
      error instanceof Error ? error.message : "DeepSeek 请求失败",
      undefined,
    );
  }

  if (!response.ok) {
    throw new DeepSeekError(`DeepSeek 返回 ${response.status}`, response.status);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new DeepSeekError("DeepSeek 没有返回摘要正文", response.status);
  }
  return content;
}
