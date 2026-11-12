import type { NapcatAccountConfig } from "@nana/config";

/** 一个 NapCat 实例对应一个 QQ 号。 */
export interface NapcatAccount {
  id: string;
  name: string;
  wsUrl: string;
  accessToken: string;
  adminGroupId?: number;
}

export function resolveNapcatAccount(
  entry: NapcatAccountConfig,
  env: NodeJS.ProcessEnv,
): NapcatAccount {
  const accessToken =
    entry.accessToken ?? (entry.accessTokenEnv ? env[entry.accessTokenEnv] : undefined);
  if (!accessToken) {
    throw new Error(
      `NapCat 账号 "${entry.id}" 缺少 access token：请检查 accounts[].napcat.accessToken 或 ${entry.accessTokenEnv ?? "accessTokenEnv"}。`,
    );
  }
  const wsUrl = entry.wsUrl ?? (entry.wsUrlEnv ? env[entry.wsUrlEnv] : undefined);
  if (!wsUrl) {
    throw new Error(
      `NapCat 账号 "${entry.id}" 缺少 WebSocket 地址：请检查 accounts[].napcat.wsUrl 或 ${entry.wsUrlEnv ?? "wsUrlEnv"}。`,
    );
  }
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    wsUrl,
    accessToken,
    adminGroupId: entry.adminGroup,
  };
}
