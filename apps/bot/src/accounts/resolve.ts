import { parseQQConfig, type ParsedQQConfig } from "@nana/config";
import { resolveNapcatAccount, resolveNapcatAccounts, type NapcatAccount } from "./napcat.ts";
import { resolveOfficialAccounts, type OfficialAccount } from "./official.ts";

export type QQRuntimeAccount = OfficialAccount | (NapcatAccount & { provider: "napcat" });
export interface QQAccountSet {
  provider: ParsedQQConfig["provider"];
  accounts: QQRuntimeAccount[];
  unavailable: { id: string; name: string; provider: "napcat" | "official"; error: Error }[];
  defaultAccountId: string;
}

/** 统一准备两种通道；新账号列表按账号隔离缺失凭据，默认路由不会随可用性漂移。 */
export function resolveQQAccounts(
  config: unknown,
  env: NodeJS.ProcessEnv = process.env,
): QQAccountSet {
  const qq = parseQQConfig(config);
  if (qq.source === "legacy-napcat") {
    const legacy = resolveNapcatAccounts(config, env);
    return {
      provider: qq.provider,
      accounts: legacy.accounts.map((account) => ({ ...account, provider: "napcat" })),
      unavailable: legacy.unavailable.map((account) => ({ ...account, provider: "napcat" })),
      defaultAccountId: qq.defaultAccountId,
    };
  }
  const accounts: QQRuntimeAccount[] = [];
  const unavailable: QQAccountSet["unavailable"] = [];
  for (const entry of qq.accounts) {
    try {
      accounts.push(
        entry.provider === "official"
          ? resolveOfficialAccounts([entry], env)[0]
          : { ...resolveNapcatAccount(entry, env), provider: "napcat" },
      );
    } catch (cause) {
      unavailable.push({
        id: entry.id,
        name: entry.name ?? entry.id,
        provider: entry.provider,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      });
    }
  }
  const appIds = new Set<string>();
  for (const account of accounts) {
    if (account.provider !== "official") continue;
    if (appIds.has(account.appId))
      throw new Error(`官方 QQ 账号 ${account.id} 与其他账号使用相同 AppID。`);
    appIds.add(account.appId);
  }
  if (!accounts.length)
    throw new AggregateError(
      unavailable.map((account) => account.error),
      "没有可启动的 QQ 账号，请检查各账号的连接凭据。",
    );
  return { provider: qq.provider, accounts, unavailable, defaultAccountId: qq.defaultAccountId };
}
