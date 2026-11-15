import { z } from "zod";
import type { BridgeStore } from "../bridge/store.ts";
import type { BotApp } from "../core/app.ts";
import type { OutgoingMessage } from "../message/types.ts";
import type { Logger } from "../core/logger.ts";
import { BotControlError } from "./testMessage.ts";

/** 桥接在控制接口侧需要的运行时：运行中的账号应用 + 该账号的桥接存储。 */
export interface BridgeRuntime {
  app: Pick<BotApp, "replyMessage" | "sendMessage" | "sendTyping">;
  store: BridgeStore;
}

export interface BridgeDeps {
  bridges: ReadonlyMap<string, BridgeRuntime>;
  logger: Logger;
}

function requireRuntime(deps: BridgeDeps, accountId: string): BridgeRuntime {
  const runtime = deps.bridges.get(accountId);
  if (!runtime) {
    throw new BotControlError(503, `账号 ${accountId} 未启用桥接或未运行。`);
  }
  return runtime;
}

const statusQuerySchema = z
  .object({
    since: z.coerce.number().int().min(0).default(0),
    wait: z.coerce.number().int().min(0).max(55).default(0),
  })
  .strict();

/**
 * 无需口令的状态探针：只暴露是否已绑定与最近入站 seq，不含任何消息内容。
 * 可选 since/wait 长轮询：wait 秒内 latestInboundSeq 未超过 since 就一直挂起，
 * 有新入站立刻返回；wait=0（缺省）时立即返回当前值。
 */
export async function getBridgeStatus(
  deps: BridgeDeps,
  accountId: string,
  query?: { since?: unknown; wait?: unknown },
) {
  const runtime = requireRuntime(deps, accountId);
  const parsed = statusQuerySchema.safeParse({
    since: query?.since ?? undefined,
    wait: query?.wait ?? undefined,
  });
  if (!parsed.success) {
    throw new BotControlError(400, "since/wait 参数不合法。");
  }
  const latestInboundSeq = await runtime.store.waitForInboundAfter(
    parsed.data.since,
    parsed.data.wait * 1_000,
  );
  const state = runtime.store.read();
  return {
    bound: Boolean(state.ownerId),
    latestInboundSeq,
  };
}

const afterSchema = z.coerce.number().int().min(0).default(0);

/** 读取 seq 大于 after 的消息；未绑定时附带候选发送者（不含回复上下文）。 */
export function getBridgeMessages(deps: BridgeDeps, accountId: string, afterRaw: unknown) {
  const runtime = requireRuntime(deps, accountId);
  const parsed = afterSchema.safeParse(afterRaw ?? 0);
  if (!parsed.success) {
    throw new BotControlError(400, "after 参数不合法。");
  }
  const state = runtime.store.read();
  return {
    bound: Boolean(state.ownerId),
    ownerId: state.ownerId ?? null,
    candidates: state.ownerId
      ? []
      : state.candidates.map((candidate) => ({
          senderId: candidate.senderId,
          senderName: candidate.senderName ?? null,
          text: candidate.text,
          at: candidate.at,
        })),
    messages: runtime.store.messagesAfter(parsed.data),
  };
}

const bindSchema = z
  .object({
    accountId: z.string().min(1),
    senderId: z.string().min(1),
  })
  .strict();

/** 把候选发送者绑定为主人；不在候选列表中的 senderId 一律拒绝。 */
export function bindBridgeOwner(deps: BridgeDeps, payload: unknown) {
  const parsed = bindSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BotControlError(400, "请求参数不合法，只支持 accountId 与 senderId。");
  }
  const runtime = requireRuntime(deps, parsed.data.accountId);
  try {
    const state = runtime.store.bindOwner(parsed.data.senderId);
    deps.logger.info(`[bridge] 账号 ${parsed.data.accountId} 已绑定主人 ${parsed.data.senderId}`);
    return { bound: true, ownerId: state.ownerId ?? null };
  } catch (error) {
    throw new BotControlError(400, error instanceof Error ? error.message : "绑定失败。");
  }
}

const sendSchema = z
  .object({
    accountId: z.string().min(1),
    text: z.string().trim().max(2_000).optional(),
    markdown: z.string().trim().min(1).max(4_000).optional(),
    image: z.string().trim().min(1).max(8_000_000).optional(),
    voice: z.string().trim().min(1).max(8_000_000).optional(),
  })
  .strict()
  .refine((value) => (value.text ?? "") !== "" || value.markdown || value.image || value.voice, {
    message: "text、markdown、image、voice 至少提供一项。",
  })
  .refine((value) => !(value.markdown && value.image), {
    message: "markdown 与 image 不能同时提供。",
  })
  .refine((value) => !(value.markdown && value.text), {
    message: "markdown 不能与 text 同时提供（官方要求带 markdown 时 content 为空）。",
  })
  .refine((value) => !(value.voice && (value.text || value.markdown || value.image)), {
    message: "voice 独立发送，不能与 text、markdown、image 同时提供。",
  });

/**
 * 经 bot 向主人发送一条私聊（纯文本 / Markdown / 图片带说明 / 语音）。
 * 优先走最近入站消息的被动回复（官方 C2C 窗口 60 分钟）；窗口过期或次数用尽时
 * 适配层会抛错，再回退主动发送。两次都失败则记录失败并返回 502，不假装送达。
 */
export async function sendBridgeMessage(deps: BridgeDeps, payload: unknown) {
  const parsed = sendSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BotControlError(
      400,
      "请求参数不合法：支持 accountId 与 text / markdown / image / voice（互斥规则见接口说明）。",
    );
  }
  const { accountId } = parsed.data;
  const kind = parsed.data.markdown
    ? "markdown"
    : parsed.data.image
      ? "image"
      : parsed.data.voice
        ? "voice"
        : "text";
  const outgoing: OutgoingMessage = {
    text: parsed.data.markdown || parsed.data.voice ? "" : (parsed.data.text ?? ""),
    ...(parsed.data.markdown ? { markdown: parsed.data.markdown } : {}),
    ...(parsed.data.image ? { image: parsed.data.image } : {}),
    ...(parsed.data.voice ? { voice: parsed.data.voice } : {}),
  };
  // 记录里留可读文本：图片留说明或占位，Markdown 留原文，语音留占位。
  const recordText =
    kind === "markdown"
      ? (parsed.data.markdown as string)
      : kind === "image"
        ? (parsed.data.text ?? "[图片]")
        : kind === "voice"
          ? "[语音]"
          : (parsed.data.text as string);
  const runtime = requireRuntime(deps, accountId);
  const state = runtime.store.read();
  if (!state.ownerId) {
    throw new BotControlError(409, "尚未绑定主人，无法发送。");
  }

  let replyError: unknown;
  if (state.lastInbound) {
    try {
      await runtime.app.replyMessage(state.lastInbound, outgoing);
      const record = runtime.store.recordOutbound(recordText, "reply", undefined, kind);
      deps.logger.info(`[bridge] 账号 ${accountId} 已被动回复主人（seq=${record.seq}）`);
      return { record, via: "reply" as const };
    } catch (error) {
      // 被动回复失败多半是窗口/次数限制，属于预期内的回退路径，不算异常。
      replyError = error;
      deps.logger.info(
        `[bridge] 账号 ${accountId} 被动回复不可用，改为主动发送：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    await runtime.app.sendMessage(
      {
        platform: state.lastInbound?.platform ?? "official",
        accountId,
        scene: "private",
        conversationId: state.ownerId,
      },
      outgoing,
    );
    const record = runtime.store.recordOutbound(recordText, "proactive", undefined, kind);
    deps.logger.info(`[bridge] 账号 ${accountId} 已主动发送给主人（seq=${record.seq}）`);
    return { record, via: "proactive" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "发送失败";
    runtime.store.recordOutbound(recordText, "proactive", message.slice(0, 500), kind);
    deps.logger.warn(`[bridge] 账号 ${accountId} 发送给主人失败：${message}`);
    void replyError;
    throw new BotControlError(502, message.slice(0, 500) || "发送失败");
  }
}

const typingSchema = z
  .object({
    accountId: z.string().min(1),
    seconds: z.coerce.number().int().min(1).max(60).default(10),
  })
  .strict();

/** 给主人发「输入中」状态（官方 C2C msg_type=6），让等待回复时对方能看到正在输入。 */
export async function sendBridgeTyping(deps: BridgeDeps, payload: unknown) {
  const parsed = typingSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BotControlError(400, "请求参数不合法，只支持 accountId 与 seconds（1-60）。");
  }
  const runtime = requireRuntime(deps, parsed.data.accountId);
  const state = runtime.store.read();
  if (!state.ownerId) {
    throw new BotControlError(409, "尚未绑定主人，无法发送输入中状态。");
  }
  try {
    await runtime.app.sendTyping(
      {
        platform: state.lastInbound?.platform ?? "official",
        accountId: parsed.data.accountId,
        scene: "private",
        conversationId: state.ownerId,
      },
      parsed.data.seconds,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "发送输入中状态失败";
    throw new BotControlError(502, message.slice(0, 500) || "发送输入中状态失败");
  }
  return { typing: true, seconds: parsed.data.seconds };
}
