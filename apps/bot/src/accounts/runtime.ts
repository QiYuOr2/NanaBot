import type { StorageOptions } from "@nana/storage";
import { createApp } from "../core/createApp.ts";
import { RECONNECT_DELAY_MS, UNLIMITED_RECONNECT_ATTEMPTS } from "../core/connection.ts";
import type { BotApp } from "../core/app.ts";
import type { Logger } from "../core/logger.ts";
import { createOfficialApp } from "../qq/app.ts";
import type { QQRuntimeAccount } from "./resolve.ts";

export function createAccountApp(
  account: QQRuntimeAccount,
  options: { storage?: StorageOptions; logger: Logger },
): BotApp {
  if (account.provider === "official") return createOfficialApp({ account, ...options });
  return createApp({
    websocket: {
      baseUrl: account.wsUrl,
      accessToken: account.accessToken,
      reconnection: {
        enable: account.watchdog ?? false,
        attempts: UNLIMITED_RECONNECT_ATTEMPTS,
        delay: RECONNECT_DELAY_MS,
      },
    },
    account: { id: account.id, name: account.name },
    adminGroupId: account.adminGroupId,
    connection: { enabled: account.watchdog ?? false },
    ...options,
    handleSignals: false,
  });
}

/** 每个连接单独启动与清理，部分账号不可用时让其余账号继续服务。 */
export async function startAccountApps<T extends { app: BotApp; logger: Logger }>(
  runtimes: readonly T[],
): Promise<T[]> {
  if (!runtimes.length) return [];
  const results = await Promise.allSettled(runtimes.map((runtime) => runtime.app.start()));
  const active: T[] = [];
  const errors: unknown[] = [];
  for (const [index, result] of results.entries()) {
    const runtime = runtimes[index];
    if (result.status === "fulfilled") {
      active.push(runtime);
      continue;
    }
    errors.push(result.reason);
    runtime.logger.error(
      `[app] QQ 账号 ${runtime.app.accountId ?? "unknown"} 启动失败`,
      result.reason,
    );
    try {
      await runtime.app.stop();
    } catch (error) {
      runtime.logger.error("[app] 清理失败账号时发生错误", error);
    }
  }
  if (!active.length) throw new AggregateError(errors, "所有 QQ 账号均启动失败");
  return active;
}
