import { loadOfficialGroups } from "@nana/config";
import { Structs } from "node-napcat-ts";
import { z } from "zod";
import type { QQRuntimeAccount } from "../accounts/resolve.ts";
import type { BotApp } from "../core/app.ts";
import type { Logger } from "../core/logger.ts";

const schema = z
  .object({
    accountId: z.string().min(1),
    groupId: z.string().regex(/^[1-9]\d*$/),
    expectedOpenid: z.string().min(1).nullable().optional(),
    kind: z.enum(["text", "atAll"]),
  })
  .strict();

const TEST_TEXT = {
  text: "NanaBot 普通测试消息：群消息发送测试。",
  atAll: "NanaBot @全体测试消息：群提醒测试。",
} as const;

export class BotControlError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "BotControlError";
    this.statusCode = statusCode;
  }
}

export interface TestMessageRuntime {
  account: QQRuntimeAccount;
  app: Pick<BotApp, "sendGroupMsg">;
}

export interface TestMessageDeps {
  runtimes: ReadonlyMap<string, TestMessageRuntime>;
  rootDir: string;
  logger: Logger;
}

/** 由运行中的 bot 使用当前账号发送，统一走 BotApp 的通道实现和推送记录。 */
export async function sendTestMessage(
  payload: unknown,
  deps: TestMessageDeps,
): Promise<{ target: string }> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new BotControlError(400, "请求参数不合法，只支持账号、群别名、消息类型和预期 openid。");
  }
  const input = parsed.data;
  const groupId = Number(input.groupId);
  if (!Number.isSafeInteger(groupId)) {
    throw new BotControlError(400, "群别名不合法。");
  }

  const runtime = deps.runtimes.get(input.accountId);
  if (!runtime) {
    throw new BotControlError(503, `bot 未运行账号 ${input.accountId}，请检查该账号是否启动成功。`);
  }
  if (runtime.account.provider === "official") {
    const groups = loadOfficialGroups(input.accountId, deps.rootDir);
    const group = groups[input.groupId];
    if (!group) throw new BotControlError(400, `群 ${input.groupId} 未保存 group_openid 映射。`);
    if (input.expectedOpenid != null && group.openid !== input.expectedOpenid) {
      throw new BotControlError(409, "群映射已变更，请刷新配置后再测试。");
    }
  }

  const atAll = input.kind === "atAll";
  const text = TEST_TEXT[input.kind];
  const messages = atAll ? [Structs.at("all"), Structs.text(text)] : [Structs.text(text)];
  try {
    const target = await runtime.app.sendGroupMsg(
      groupId,
      { purpose: "message.test", content: text, subject: "NanaBot" },
      messages,
    );
    deps.logger.info(`[control] 账号 ${input.accountId} 已向群 ${target} 发送测试消息`);
    return { target };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "测试消息发送失败";
    const message =
      runtime.account.provider === "official"
        ? raw.replaceAll(runtime.account.appSecret, "[已隐藏]")
        : raw;
    deps.logger.warn(`[control] 账号 ${input.accountId} 发送测试消息失败：${message}`);
    throw new BotControlError(502, message.slice(0, 500) || "测试消息发送失败");
  }
}
