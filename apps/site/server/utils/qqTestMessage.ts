import { createError } from "h3";
import { readConfig, parseQQConfig } from "@nana/config";
import { BOT_CONTROL_DEFAULT_URL, BOT_CONTROL_TEST_MESSAGE_PATH, ENV_KEYS } from "@nana/constants";
import { readAppEnvValue } from "@nana/utils";
import type { QQTestMessageKind } from "../../shared/qq-groups.ts";

const BOT_CONTROL_TIMEOUT_MS = 15_000;

export async function sendQQTestMessage(input: {
  accountId: string;
  groupId: string;
  expectedOpenid: string | null;
  kind: QQTestMessageKind;
}) {
  const account = parseQQConfig(readConfig()).accounts.find(
    (entry) => entry.id === input.accountId,
  );
  if (!account || account.provider !== "official")
    throw createError({ statusCode: 400, statusMessage: "请选择已配置的官方 QQ 账号" });
  const group = account.groups[input.groupId];
  if (!group) throw createError({ statusCode: 400, statusMessage: "请先保存该群的 group_openid" });
  if (group.openid !== input.expectedOpenid)
    throw createError({ statusCode: 409, statusMessage: "群映射已变更，请刷新配置后再测试" });

  const token = readAppEnvValue("site", ENV_KEYS.NANA_SITE_CONFIG_TOKEN);
  if (!token || token.length < 16) {
    throw createError({
      statusCode: 503,
      statusMessage: "配置管理口令不可用",
      data: { message: "请先设置至少 16 位的 NANA_SITE_CONFIG_TOKEN。" },
    });
  }
  const controlUrl = (
    readAppEnvValue("site", ENV_KEYS.NANA_BOT_CONTROL_URL) || BOT_CONTROL_DEFAULT_URL
  ).replace(/\/+$/u, "");

  let response: Response;
  try {
    response = await fetch(`${controlUrl}${BOT_CONTROL_TEST_MESSAGE_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accountId: input.accountId,
        groupId: input.groupId,
        expectedOpenid: input.expectedOpenid,
        kind: input.kind,
      }),
      signal: AbortSignal.timeout(BOT_CONTROL_TIMEOUT_MS),
    });
  } catch (cause) {
    const timeout = cause instanceof Error && cause.name === "TimeoutError";
    throw createError({
      statusCode: timeout ? 504 : 503,
      statusMessage: timeout ? "bot 控制接口响应超时" : "bot 控制接口不可达",
      data: {
        message: timeout
          ? "bot 未在限定时间内响应，消息可能仍在发送，请先确认群内结果再重试。"
          : "请确认 bot 已启动，并检查 NANA_BOT_CONTROL_URL 配置。",
      },
    });
  }

  const payload = (await response.json().catch(() => undefined)) as
    | { ok?: boolean; target?: unknown; error?: unknown }
    | undefined;
  if (!response.ok || payload?.ok !== true) {
    const message =
      typeof payload?.error === "string" ? payload.error : `bot 返回 HTTP ${response.status}`;
    const statusCode =
      response.status >= 400 && response.status !== 401 && response.status !== 403
        ? response.status
        : 502;
    throw createError({ statusCode, statusMessage: "测试消息发送失败", data: { message } });
  }
  return { sent: true, target: typeof payload.target === "string" ? payload.target : undefined };
}
