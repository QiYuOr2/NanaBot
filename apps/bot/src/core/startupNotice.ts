import type { BotApp } from "./app";
import type { Logger } from "./logger";

/** READY / RESUMED 都会触发连接事件，启动提醒在本次应用生命周期内只发送一次。 */
export function registerStartupNotice(
  app: Pick<BotApp, "onConnected" | "sendAdminText" | "adminGroupId">,
  text: string | undefined | (() => string | undefined),
  logger: Logger,
): void {
  if (!app.adminGroupId) return;
  if (typeof text !== "function" && !text) return;
  let attempted = false;
  app.onConnected(() => {
    if (attempted) return;
    // 文案在连接成功的当下才求值：部署标记这类运行时状态以发送时为准。
    const resolved = typeof text === "function" ? text() : text;
    if (!resolved) return;
    // 在异步发送前标记，避免重复事件或发送失败后在每次重连时再次推送。
    attempted = true;
    void app
      .sendAdminText(resolved, { purpose: "app.online" })
      .then(() => logger.info(`上线提示已发送到管理群 ${app.adminGroupId}`))
      .catch((error) => logger.error("[app] 发送机器人上线提示失败", error));
  });
}
