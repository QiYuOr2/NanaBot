import type { OfficialAccountConfig, QQAccountConfig } from "@nana/config";

export interface OfficialAccount extends OfficialAccountConfig {
  name: string;
  appId: string;
  appSecret: string;
  adminGroupId?: number;
}

/** 官方通道不回退 NapCat，也不将真实群号当作 openid。 */
export function resolveOfficialAccounts(
  entries: readonly QQAccountConfig[],
  env: NodeJS.ProcessEnv = process.env,
): OfficialAccount[] {
  const appIds = new Set<string>();
  return entries
    .filter((entry): entry is OfficialAccountConfig => entry.provider === "official")
    .map((entry) => {
      const appId = env[entry.appIdEnv]?.trim();
      const appSecret = env[entry.appSecretEnv]?.trim();
      if (!appId || !appSecret) {
        throw new Error(
          `官方 QQ 账号 "${entry.id}" 缺少 ${entry.appIdEnv} / ${entry.appSecretEnv}，请配置 .env 或运行 qq:bind。`,
        );
      }
      if (appIds.has(appId))
        throw new Error(
          `官方 QQ 账号 "${entry.id}" 与其他账号使用相同 AppID，请为每个机器人配置独立的 appIdEnv / appSecretEnv。`,
        );
      appIds.add(appId);
      return {
        ...entry,
        name: entry.name ?? entry.id,
        appId,
        appSecret,
        adminGroupId: entry.adminGroup,
      };
    });
}

/** 在启动监控前检查所有发送目标，避免开播时才发现路由缺失。 */
export function validateOfficialTargets(
  account: OfficialAccount,
  groupIds: readonly number[],
): void {
  for (const id of new Set([
    ...groupIds,
    ...(account.adminGroupId ? [account.adminGroupId] : []),
  ])) {
    if (!account.groups[String(id)]) {
      throw new Error(
        `官方 QQ 账号 "${account.id}" 缺少群 ${id} 的映射：请配置 accounts[].groups.${id}.openid（group_openid，非 QQ 群号）。`,
      );
    }
  }
}
