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
    gsince: z.coerce.number().int().min(0).default(0),
    wait: z.coerce.number().int().min(0).max(55).default(0),
  })
  .strict();

/**
 * 无需口令的状态探针：只暴露是否已绑定与最近入站 seq（私聊 since / 群 gsince 两条线），
 * 不含任何消息内容。可选长轮询：wait 秒内任一侧有新入站立刻返回两边的当前值；
 * wait=0（缺省）时立即返回。
 */
export async function getBridgeStatus(
  deps: BridgeDeps,
  accountId: string,
  query?: { since?: unknown; gsince?: unknown; wait?: unknown },
) {
  const runtime = requireRuntime(deps, accountId);
  const parsed = statusQuerySchema.safeParse({
    since: query?.since ?? undefined,
    gsince: query?.gsince ?? undefined,
    wait: query?.wait ?? undefined,
  });
  if (!parsed.success) {
    throw new BotControlError(400, "since/gsince/wait 参数不合法。");
  }
  const latest = await runtime.store.waitForAnyInboundAfter(
    { c2c: parsed.data.since, group: parsed.data.gsince },
    parsed.data.wait * 1_000,
  );
  const state = runtime.store.read();
  const latestGroup = runtime.store.latestGroupInbound();
  return {
    bound: Boolean(state.ownerId),
    latestInboundSeq: latest.c2c,
    latestGroupInboundSeq: latest.group,
    latestGroupId: latestGroup?.groupId ?? null,
  };
}

const afterSchema = z.coerce.number().int().min(0).default(0);

/**
 * 读取 seq 大于 after 的消息；未绑定时附带候选发送者（不含回复上下文）。
 * 带 groupId 时改读该群的记录；两种情况都附带已发现群的摘要列表。
 */
export function getBridgeMessages(
  deps: BridgeDeps,
  accountId: string,
  afterRaw: unknown,
  groupIdRaw?: unknown,
) {
  const runtime = requireRuntime(deps, accountId);
  const parsed = afterSchema.safeParse(afterRaw ?? 0);
  if (!parsed.success) {
    throw new BotControlError(400, "after 参数不合法。");
  }
  const state = runtime.store.read();
  const groups = runtime.store.listGroups();
  if (typeof groupIdRaw === "string" && groupIdRaw) {
    return {
      bound: Boolean(state.ownerId),
      ownerId: state.ownerId ?? null,
      candidates: [],
      groupId: groupIdRaw as string | null,
      groups,
      messages: runtime.store.groupMessagesAfter(groupIdRaw, parsed.data),
    };
  }
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
    groupId: null as string | null,
    groups,
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
    /** 目标群的 group_openid；缺省为私聊主人。带此字段时 text 等形态规则相同，发送目标改为该群。 */
    groupId: z.string().min(1).optional(),
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
  if (parsed.data.groupId) {
    return sendBridgeGroupMessage(
      deps,
      runtime,
      accountId,
      parsed.data.groupId,
      outgoing,
      recordText,
      kind,
    );
  }
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

/**
 * 向某个群发送一条消息（形态规则与私聊相同）。群必须先被 @ 建档（有 lastInbound 上下文），
 * 否则 409。优先被动回复该群最近一条 @ 消息；失败回退主动发送（官方群主动发言需要
 * 群主授权，未授权时平台会拒绝并如实返回 502）。群发送不要求先绑定主人。
 */
async function sendBridgeGroupMessage(
  deps: BridgeDeps,
  runtime: BridgeRuntime,
  accountId: string,
  groupId: string,
  outgoing: OutgoingMessage,
  recordText: string,
  kind: "text" | "markdown" | "image" | "voice",
) {
  const group = runtime.store.groupState(groupId);
  if (!group?.lastInbound) {
    throw new BotControlError(409, "这个群还没有被 @ 记录过，无法发送（先在群里 @ 一次机器人）。");
  }
  try {
    await runtime.app.replyMessage(group.lastInbound, outgoing);
    const record = runtime.store.recordGroupOutbound(groupId, recordText, "reply", undefined, kind);
    deps.logger.info(`[bridge] 账号 ${accountId} 已在群 ${groupId} 被动回复（seq=${record.seq}）`);
    return { record, via: "reply" as const };
  } catch (error) {
    deps.logger.info(
      `[bridge] 账号 ${accountId} 群 ${groupId} 被动回复不可用，改为主动发送：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await runtime.app.sendMessage(
      {
        platform: group.lastInbound.platform,
        accountId,
        scene: "group",
        conversationId: groupId,
      },
      outgoing,
    );
    const record = runtime.store.recordGroupOutbound(
      groupId,
      recordText,
      "proactive",
      undefined,
      kind,
    );
    deps.logger.info(`[bridge] 账号 ${accountId} 已在群 ${groupId} 主动发送（seq=${record.seq}）`);
    return { record, via: "proactive" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "发送失败";
    runtime.store.recordGroupOutbound(
      groupId,
      recordText,
      "proactive",
      message.slice(0, 500),
      kind,
    );
    deps.logger.warn(`[bridge] 账号 ${accountId} 向群 ${groupId} 发送失败：${message}`);
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
