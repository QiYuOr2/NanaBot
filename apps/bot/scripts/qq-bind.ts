import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectQQRobot } from "@nana/qq/connect";
import { readConfig, selectOfficialAccount } from "@nana/config";

const account = selectOfficialAccount(readConfig(), process.argv[2]);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const credentials = await connectQQRobot({ signal: controller.signal });
if (credentials.length !== 1)
  throw new Error("扫码返回的机器人数量不是 1，未写入凭据，请逐个账号绑定。");
const credential = credentials[0];
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
let content = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
for (const [key, value] of [
  [account.appIdEnv, credential.appId],
  [account.appSecretEnv, credential.appSecret],
]) {
  // 腾讯凭据应为单行值；拒绝可改变 dotenv 语义的内容。
  if (!value || /[\r\n"\\]/.test(value)) throw new Error("扫码凭据格式异常，未写入 .env。");
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
  content = pattern.test(content)
    ? content.replace(pattern, () => line)
    : `${content.trimEnd()}\n${line}\n`;
}
writeFileSync(envFile, content, { mode: 0o600 });
chmodSync(envFile, 0o600);
console.info(`官方 QQ 账号 ${account.id} 绑定成功，凭据已写入 apps/bot/.env（未打印密钥）。`);
