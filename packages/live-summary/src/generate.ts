import {
  claimLiveSummary,
  completeLiveSummary,
  readDanmuMessages,
  readDanmuSession,
  readLiveSummary,
  type LiveSummaryRecord,
  type LiveSummarySource,
  type StorageOptions,
} from "@nana/storage";
import { DeepSeekError, requestDeepSeekChat } from "./deepseek.ts";
import { buildDanmuExcerpt, type SummaryMessage } from "./excerpt.ts";
import { buildSummaryPrompt } from "./prompt.ts";
import { normalizeSummaryText } from "./summaryText.ts";

export interface GenerateLiveSummaryInput {
  streamer: string;
  messages: readonly SummaryMessage[];
  apiKey: string | undefined;
  fetch?: typeof globalThis.fetch;
}

export interface GeneratedLiveSummary {
  status: "ok" | "empty" | "failed";
  text: string | null;
  /** 给页面或日志看的原因。成功时不带。 */
  message?: string;
}

/** 根据弹幕调用模型。没有弹幕、没有密钥或请求失败都返回可落库的状态，不抛出。 */
export async function generateLiveSummary(
  input: GenerateLiveSummaryInput,
): Promise<GeneratedLiveSummary> {
  const excerpt = buildDanmuExcerpt(input.messages);
  if (excerpt.usableCount === 0) {
    return { status: "empty", text: null, message: "本场没有记录到弹幕，无法推断" };
  }

  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    return { status: "failed", text: null, message: "未配置 DEEPSEEK_API_KEY，无法生成摘要" };
  }

  const prompt = buildSummaryPrompt({
    streamer: input.streamer,
    messageCount: excerpt.usableCount,
    excerpt: excerpt.text,
    fullTranscript: excerpt.mode === "full",
  });

  try {
    const raw = await requestDeepSeekChat({
      apiKey,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      fetch: input.fetch,
    });
    const text = normalizeSummaryText(raw);
    if (text.length === 0) {
      return { status: "failed", text: null, message: "模型没有返回可用摘要" };
    }
    return { status: "ok", text };
  } catch (error) {
    return { status: "failed", text: null, message: failureMessage(error) };
  }
}

export type SettleLiveSummaryResult =
  | { kind: "missing" }
  | { kind: "active" }
  | { kind: "busy" }
  | {
      kind: "ready";
      status: "ok" | "empty" | "failed" | "pending";
      text: string | null;
      /** 仅当这次调用刚替机器人写入一份成功摘要时为 true，调用方才应该发群。 */
      shouldPush: boolean;
      message?: string;
    };

export interface SettleLiveSummaryOptions extends StorageOptions {
  sessionId: number;
  source: LiveSummarySource;
  apiKey: string | undefined;
  fetch?: typeof globalThis.fetch;
  now?: Date;
}

/**
 * 认领一场摘要并在需要时生成。
 *
 * 已经有成功或「没有弹幕」结果时直接返回，保证群消息和页面不会各写一份。
 * 页面来源永远 `shouldPush = false`。
 */
export async function settleLiveSummary(
  options: SettleLiveSummaryOptions,
): Promise<SettleLiveSummaryResult> {
  const storage: StorageOptions = { rootDir: options.rootDir };
  const claim = claimLiveSummary(options.sessionId, { ...storage, now: options.now });

  if (claim.kind === "missing" || claim.kind === "active" || claim.kind === "busy") {
    return claim;
  }
  if (claim.kind === "existing") {
    return readyFromRecord(claim.summary, false);
  }

  const generated = await generateLiveSummary({
    streamer: readDanmuSession(options.sessionId, storage)?.streamer ?? "主播",
    messages: readDanmuMessages(options.sessionId, storage),
    apiKey: options.apiKey,
    fetch: options.fetch,
  });

  const wrote = completeLiveSummary(
    options.sessionId,
    claim.claimedAt,
    {
      status: generated.status,
      text: generated.status === "ok" ? generated.text : null,
      source: options.source,
    },
    storage,
  );

  if (!wrote) {
    const current = readLiveSummary(options.sessionId, storage);
    if (!current) {
      return { kind: "missing" };
    }
    if (!current.ended) {
      return { kind: "active" };
    }
    if (current.status === "pending" || current.status === null) {
      return { kind: "busy" };
    }
    return readyFromRecord(current, false);
  }

  return {
    kind: "ready",
    status: generated.status,
    text: generated.status === "ok" ? generated.text : null,
    shouldPush: options.source === "bot" && generated.status === "ok" && generated.text !== null,
    message: generated.message,
  };
}

function readyFromRecord(summary: LiveSummaryRecord, shouldPush: boolean): SettleLiveSummaryResult {
  return {
    kind: "ready",
    status: summary.status ?? "failed",
    text: summary.status === "ok" ? summary.text : null,
    shouldPush,
  };
}

function failureMessage(error: unknown): string {
  if (error instanceof DeepSeekError && (error.status === 401 || error.status === 403)) {
    return "DeepSeek 拒绝了当前密钥";
  }
  return "生成摘要失败，请稍后再试";
}
