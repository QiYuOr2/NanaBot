import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { readConfig, selectOfficialAccount } from "@nana/config";
import { QQClient } from "@nana/qq";
import { resolveOfficialAccounts } from "../src/qq/config.ts";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const entry = selectOfficialAccount(readConfig(), process.argv[2]);
const [account] = resolveOfficialAccounts([entry]);
const client = new QQClient({
  appId: account.appId,
  appSecret: account.appSecret,
  accountId: account.id,
  logger: console,
  sandbox: account.sandbox,
});
client.on("connected", () =>
  console.info(
    `账号 ${account.id} 已连接。请将机器人加入目标群，或在群内 @机器人 发一条消息；按 Ctrl+C 退出。`,
  ),
);
client.on("error", (error) => console.error("官方 QQ 连接错误", error));
client.on("groupDiscovered", (group) => {
  console.info(`账号 ${account.id}: group_openid=${group.openid}`);
});
process.once("SIGINT", () => client.stop());
process.once("SIGTERM", () => client.stop());
await client.start();
