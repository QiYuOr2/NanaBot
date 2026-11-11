import { ENV_KEYS } from "@nana/constants";
import { z } from "zod";

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const accountSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).optional(),
  appIdEnv: envName.default(ENV_KEYS.QQ_BOT_APP_ID),
  appSecretEnv: envName.default(ENV_KEYS.QQ_BOT_APP_SECRET),
  sandbox: z.boolean().default(false),
  adminGroup: z.number().int().positive().optional(),
  // 数字仅为本地路由别名；官方接口只能使用 group_openid。
  groups: z
    .record(
      z.string().regex(/^[1-9]\d*$/),
      z.object({
        openid: z.string().trim().min(1),
        name: z.string().min(1).optional(),
      }),
    )
    .default({}),
});

const configSchema = z.object({
  qq: z
    .object({
      provider: z.enum(["napcat", "official"]).default("napcat"),
      accounts: z.array(accountSchema).default([]),
    })
    .default({ provider: "napcat", accounts: [] }),
});

export type OfficialAccountConfig = z.infer<typeof accountSchema>;
export interface OfficialAccount extends OfficialAccountConfig {
  name: string;
  appId: string;
  appSecret: string;
  adminGroupId?: number;
}

export function parseQQConfig(config: unknown) {
  const { qq } = configSchema.parse(config);
  const ids = new Set<string>();
  const envKeys = new Set<string>();
  for (const account of qq.accounts) {
    if (ids.has(account.id)) throw new Error(`qq.accounts 中存在重复的账号 id "${account.id}"。`);
    ids.add(account.id);
    for (const key of [account.appIdEnv, account.appSecretEnv]) {
      if (envKeys.has(key))
        throw new Error(`qq.accounts 中凭据环境变量 ${key} 被重复使用，请为每个账号指定独立变量。`);
      envKeys.add(key);
    }
  }
  if (qq.provider === "official" && qq.accounts.length === 0) {
    throw new Error("官方 QQ 通道需要配置 qq.accounts。");
  }
  return qq;
}

/** 官方通道不回退 NapCat，也不将真实群号当作 openid。 */
export function resolveOfficialAccounts(
  entries: readonly OfficialAccountConfig[],
  env: NodeJS.ProcessEnv = process.env,
): OfficialAccount[] {
  const appIds = new Set<string>();
  return entries.map((entry) => {
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
        `官方 QQ 账号 "${account.id}" 缺少群 ${id} 的映射：请配置 qq.accounts[].groups.${id}.openid（group_openid，非 QQ 群号）。`,
      );
    }
  }
}
