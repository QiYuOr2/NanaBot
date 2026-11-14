import { z } from "zod";
import type { BridgeStore } from "../bridge/store.ts";
import type { BotApp } from "../core/app.ts";
import type { Logger } from "../core/logger.ts";
import { BotControlError } from "./testMessage.ts";

/** 桥接在控制接口侧需要的运行时：运行中的账号应用 + 该账号的桥接存储。 */
export interface BridgeRuntime {
  app: Pick<BotApp, "replyMessage" | "sendMessage">;
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

/** 无需口令的状态探针：只暴露是否已绑定与最近入站 seq，不含任何消息内容。 */
export function getBridgeStatus(deps: BridgeDeps, accountId: string) {
  const runtime = requireRuntime(deps, accountId);
  const state = runtime.store.read();
  return {
    bound: Boolean(state.ownerId),
    latestInboundSeq: runtime.store.latestInboundSeq(),
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
    text: z.string().trim().min(1).max(2_000),
  })
  .strict();

/**
 * 经 bot 向主人发送一条私聊。
 * 优先走最近入站消息的被动回复（官方 C2C 窗口 60 分钟）；窗口过期或次数用尽时
 * 适配层会抛错，再回退主动发送。两次都失败则记录失败并返回 502，不假装送达。
 */
export async function sendBridgeMessage(deps: BridgeDeps, payload: unknown) {
  const parsed = sendSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BotControlError(400, "请求参数不合法，只支持 accountId 与 text。");
  }
  const { accountId, text } = parsed.data;
  const runtime = requireRuntime(deps, accountId);
  const state = runtime.store.read();
  if (!state.ownerId) {
    throw new BotControlError(409, "尚未绑定主人，无法发送。");
  }

  let replyError: unknown;
  if (state.lastInbound) {
    try {
      await runtime.app.replyMessage(state.lastInbound, { text });
      const record = runtime.store.recordOutbound(text, "reply");
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
      { text },
    );
    const record = runtime.store.recordOutbound(text, "proactive");
    deps.logger.info(`[bridge] 账号 ${accountId} 已主动发送给主人（seq=${record.seq}）`);
    return { record, via: "proactive" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "发送失败";
    runtime.store.recordOutbound(text, "proactive", message.slice(0, 500));
    deps.logger.warn(`[bridge] 账号 ${accountId} 发送给主人失败：${message}`);
    void replyError;
    throw new BotControlError(502, message.slice(0, 500) || "发送失败");
  }
}
