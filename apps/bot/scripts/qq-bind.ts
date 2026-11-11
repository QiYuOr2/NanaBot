import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { qrConnect } from "@tencent-connect/qqbot-connector";
import { readConfig } from "@nana/config";
import { parseQQConfig } from "../src/qq/config.ts";

const qq = parseQQConfig(readConfig());
const id = process.argv[2] ?? qq.accounts[0]?.id;
const account = qq.accounts.find((entry) => entry.id === id);
if (!account)
  throw new Error("请先在 nana.config.yaml#qq.accounts 配置账号，再运行 qq:bind [账号id]。");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const credentials = await qrConnect({ signal: controller.signal });
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
