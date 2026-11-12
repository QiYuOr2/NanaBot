import { createError } from "h3";
import { readConfig, parseQQConfig } from "@nana/config";
import { QQClient, type QQMessagePart } from "@nana/qq";
import { PUSH_PURPOSE_LABELS } from "@nana/constants";
import { writePushLog } from "@nana/storage";
import { readAppEnvValue } from "@nana/utils";
import type { QQTestMessageKind } from "../../shared/qq-groups.ts";

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

  const atAll = input.kind === "atAll";
  const text = atAll
    ? "NanaBot @全体测试消息：群提醒测试。"
    : "NanaBot 普通测试消息：群消息发送测试。";
  const parts: QQMessagePart[] = [
    ...(atAll ? [{ type: "atAll" as const }] : []),
    { type: "text", text },
  ];
  const appId = readAppEnvValue("bot", account.appIdEnv);
  const appSecret = readAppEnvValue("bot", account.appSecretEnv);
  const record = (success: boolean, error?: string) => {
    try {
      writePushLog({
        account: account.id,
        targetId: group.openid,
        target: group.name ?? `群${input.groupId}`,
        purpose: "message.test",
        purposeLabel: PUSH_PURPOSE_LABELS["message.test"],
        pushedAt: new Date().toISOString(),
        success,
        error,
        content: text,
        subject: "NanaBot",
      });
    } catch {
      // 已发送的消息不因记录失败而重试，以免再次打扰群成员。
      console.error("[site] 写入测试消息推送记录失败");
    }
  };
  if (!appId || !appSecret) {
    const message = `账号 ${account.name ?? account.id} 缺少 ${account.appIdEnv} / ${account.appSecretEnv}，请配置 apps/bot/.env。`;
    record(false, message);
    throw createError({ statusCode: 503, statusMessage: "机器人凭据未配置", data: { message } });
  }
  try {
    const client = new QQClient({ appId, appSecret, sandbox: account.sandbox });
    // 只使用 HTTP 发送，不建立第二条 Gateway 连接。
    const sent = await client.sendGroupMessage(group.openid, parts);
    record(true);
    return { sent: true, messageId: sent.id };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "官方 QQ 发送失败")
      .replaceAll(appSecret, "[已隐藏]")
      .slice(0, 500);
    record(false, message);
    throw createError({ statusCode: 502, statusMessage: "测试消息发送失败", data: { message } });
  }
}
