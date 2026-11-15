import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { createError, getHeader, type H3Event } from "h3";
import {
  BOT_CONTROL_BRIDGE_BIND_PATH,
  BOT_CONTROL_BRIDGE_MESSAGES_PATH,
  BOT_CONTROL_BRIDGE_SEND_PATH,
  BOT_CONTROL_BRIDGE_STATUS_PATH,
  BOT_CONTROL_BRIDGE_TYPING_PATH,
  BOT_CONTROL_DEFAULT_URL,
  ENV_KEYS,
} from "@nana/constants";
import { readAppEnvValue, resolveProjectRoot } from "@nana/utils";
import { tokensEqual } from "./configAuth.ts";

const BOT_CONTROL_TIMEOUT_MS = 15_000;

/**
 * Rei 桥接专用口令：进程环境 > 根目录 .env > apps/site/.env。
 * 与全站管理口令是两个独立的值；桥接 key 只能打开 /api/bridge/*。
 */
export function readBridgeToken(rootDir?: string): string | undefined {
  const fromProcess = process.env[ENV_KEYS.NANA_BRIDGE_TOKEN]?.trim();
  if (fromProcess) return fromProcess;
  try {
    const value = parseEnv(readFileSync(join(resolveProjectRoot(rootDir), ".env"), "utf8"))[
      ENV_KEYS.NANA_BRIDGE_TOKEN
    ]?.trim();
    if (value) return value;
  } catch {
    // 根目录 .env 不存在时继续看应用级 .env。
  }
  return readAppEnvValue("site", ENV_KEYS.NANA_BRIDGE_TOKEN, rootDir);
}

function readConfiguredBridgeToken(): string {
  const token = readBridgeToken();
  if (!token || token.length < 16) {
    throw createError({
      statusCode: 503,
      statusMessage: "桥接未配置口令",
      data: { message: "请先在根目录 .env 设置至少 16 位的 NANA_BRIDGE_TOKEN。" },
    });
  }
  return token;
}

/** 桥接接口的门禁：只认桥接专用口令，管理口令与登录会话都不放行。 */
export function requireBridgeKey(event: H3Event): void {
  const expected = readConfiguredBridgeToken();
  const authorization = getHeader(event, "authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!provided || !tokensEqual(expected, provided)) {
    throw createError({ statusCode: 401, statusMessage: "桥接口令不正确" });
  }
}

async function callBridge(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  timeoutMs: number = BOT_CONTROL_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const token = readConfiguredBridgeToken();
  const controlUrl = (
    readAppEnvValue("site", ENV_KEYS.NANA_BOT_CONTROL_URL) || BOT_CONTROL_DEFAULT_URL
  ).replace(/\/+$/u, "");

  let response: Response;
  try {
    response = await fetch(`${controlUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const timeout = cause instanceof Error && cause.name === "TimeoutError";
    throw createError({
      statusCode: timeout ? 504 : 503,
      statusMessage: timeout ? "bot 控制接口响应超时" : "bot 控制接口不可达",
      data: {
        message: timeout
          ? "bot 未在限定时间内响应，消息可能仍在发送，请先确认 QQ 内的结果再重试。"
          : "请确认 bot 已启动，并检查 NANA_BOT_CONTROL_URL 配置。",
      },
    });
  }

  const payload = (await response.json().catch(() => undefined)) as
    | Record<string, unknown>
    | undefined;
  if (!response.ok || payload?.ok !== true) {
    const message =
      typeof payload?.error === "string" ? payload.error : `bot 返回 HTTP ${response.status}`;
    // bot 侧 401/403 只可能是两边口令不一致（服务端配置问题），不透传给调用方当成鉴权失败。
    const statusCode =
      response.status >= 400 && response.status !== 401 && response.status !== 403
        ? response.status
        : 502;
    throw createError({ statusCode, statusMessage: "桥接请求失败", data: { message } });
  }
  return payload;
}

/** 状态探针：bot 侧该接口本身不设口令，这里也只回是否绑定与最近入站 seq（私聊/群两条线）。 */
export async function fetchBridgeStatus(
  accountId: string,
  options?: { since?: number; gsince?: number; wait?: number },
) {
  const query = new URLSearchParams({ account: accountId });
  if (options?.since !== undefined) query.set("since", String(options.since));
  if (options?.gsince !== undefined) query.set("gsince", String(options.gsince));
  if (options?.wait !== undefined) query.set("wait", String(options.wait));
  // 长轮询时 bot 会把响应挂到 wait 秒才返回，中转超时要比 wait 多留余量。
  const timeoutMs = options?.wait ? (options.wait + 10) * 1_000 : BOT_CONTROL_TIMEOUT_MS;
  const payload = await callBridge(
    `${BOT_CONTROL_BRIDGE_STATUS_PATH}?${query.toString()}`,
    { method: "GET" },
    timeoutMs,
  );
  return {
    bound: payload.bound === true,
    latestInboundSeq: typeof payload.latestInboundSeq === "number" ? payload.latestInboundSeq : 0,
    latestGroupInboundSeq:
      typeof payload.latestGroupInboundSeq === "number" ? payload.latestGroupInboundSeq : 0,
    latestGroupId: typeof payload.latestGroupId === "string" ? payload.latestGroupId : null,
  };
}

export async function fetchBridgeMessages(accountId: string, after: number, groupId?: string) {
  const query = new URLSearchParams({ account: accountId, after: String(after) });
  if (groupId) query.set("group", groupId);
  return callBridge(`${BOT_CONTROL_BRIDGE_MESSAGES_PATH}?${query.toString()}`, { method: "GET" });
}

export async function postBridgeSend(
  accountId: string,
  message: { text?: string; markdown?: string; image?: string; voice?: string; groupId?: string },
) {
  return callBridge(
    BOT_CONTROL_BRIDGE_SEND_PATH,
    {
      method: "POST",
      body: { accountId, ...message },
    },
    // 图片/语音走 base64 时请求体远超默认 15 秒档的体量预期，超时给足上传余量。
    message.image || message.voice ? 60_000 : BOT_CONTROL_TIMEOUT_MS,
  );
}

export async function postBridgeTyping(accountId: string, seconds: number) {
  return callBridge(BOT_CONTROL_BRIDGE_TYPING_PATH, {
    method: "POST",
    body: { accountId, seconds },
  });
}

export async function postBridgeBind(accountId: string, senderId: string, groupId?: string) {
  return callBridge(BOT_CONTROL_BRIDGE_BIND_PATH, {
    method: "POST",
    body: { accountId, senderId, ...(groupId ? { groupId } : {}) },
  });
}
