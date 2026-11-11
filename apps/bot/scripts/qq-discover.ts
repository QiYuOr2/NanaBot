import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { readConfig } from "@nana/config";
import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { parseQQConfig, resolveOfficialAccounts } from "../src/qq/config.ts";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const qq = parseQQConfig(readConfig());
const id = process.argv[2] ?? qq.accounts[0]?.id;
const entry = qq.accounts.find((account) => account.id === id);
if (!entry) throw new Error("请先配置 qq.accounts，再运行 qq:discover [账号id]。");
const [account] = resolveOfficialAccounts([entry]);
const bot = new QQBot({
  appId: account.appId,
  appSecret: account.appSecret,
  accountId: account.id,
  intents: 1 << 25,
  logger: console,
  ...(account.sandbox ? { baseUrl: "https://sandbox.api.sgroup.qq.com" } : {}),
});
bot.on("ready", () =>
  console.info(
    `账号 ${account.id} 已连接。请将机器人加入目标群，或在群内 @机器人 发一条消息；按 Ctrl+C 退出。`,
  ),
);
bot.on("error", (error) => console.error("官方 QQ 连接错误", error));
bot.on("message", (_context, message) => {
  if (message.kind === "group" && message.groupOpenid)
    console.info(`账号 ${account.id}: group_openid=${message.groupOpenid}`);
});
bot.on("rawEvent", (event) => {
  if (event.eventType !== "GROUP_ADD_ROBOT") return;
  const data = event.data as { group_openid?: unknown };
  if (typeof data?.group_openid === "string")
    console.info(`账号 ${account.id}: group_openid=${data.group_openid}`);
});
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
await bot.start();
