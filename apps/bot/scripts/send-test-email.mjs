import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { readConfig } from "@nana/config";
import { createEmailTransport } from "@nana/notify";

// 相对脚本目录定位 apps/bot/.env，避免依赖进程 cwd。
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
loadEnv({ path: envFile });

const from = process.env.SERVER_EMAIL;
const pass = process.env.SERVER_EMAIL_PASSWORD;
const to = process.env.TEST_EMAIL_TO;

if (!from || !pass) {
  console.error(
    "[test-email] 缺少环境变量 SERVER_EMAIL / SERVER_EMAIL_PASSWORD。请检查 apps/bot/.env（参考 .env.example）。",
  );
  process.exit(1);
}

const adminEmail = readConfig().adminEmail ?? {};
const recipient = to ?? adminEmail.address;

if (!recipient) {
  console.error(
    "[test-email] 没有收件人：请设置环境变量 TEST_EMAIL_TO，或在 nana.config.yaml 配置 adminEmail.address。",
  );
  process.exit(1);
}

const transporter = createEmailTransport({
  address: recipient,
  cc: adminEmail.cc,
  smtp: adminEmail.smtp,
});

try {
  await transporter.verify();
  console.log(`[test-email] SMTP 连接校验通过（${from}）`);

  const info = await transporter.sendMail({
    from,
    to: recipient,
    cc: adminEmail.cc,
    subject: "【NanaBot】SMTP 测试邮件",
    text: "这是一封来自 NanaBot 的测试邮件。\n收到说明 SMTP 配置可用。",
  });
  console.log(`[test-email] 发送成功，messageId: ${info.messageId}`);
} catch (error) {
  console.error("[test-email] 发送失败", error);
  process.exitCode = 1;
} finally {
  transporter.close?.();
}
