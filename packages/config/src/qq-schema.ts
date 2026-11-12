import { ENV_KEYS } from "@nana/constants";
import { z } from "zod";

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const common = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  adminGroup: z.number().int().positive().optional(),
});
const napcatSchema = common
  .extend({
    provider: z.literal("napcat"),
    napcat: z
      .object({
        wsUrl: z.string().min(1).optional(),
        wsUrlEnv: envName.optional(),
        accessToken: z.string().min(1).optional(),
        accessTokenEnv: envName.optional(),
        watchdog: z.boolean().optional(),
      })
      .strict()
      .refine((value) => value.wsUrl || value.wsUrlEnv, "需要配置 wsUrl 或 wsUrlEnv")
      .refine(
        (value) => value.accessToken || value.accessTokenEnv,
        "需要配置 accessToken 或 accessTokenEnv",
      ),
  })
  .strict()
  .transform(({ napcat, ...account }) => ({ ...account, ...napcat }));
const officialSchema = common
  .extend({
    provider: z.literal("official"),
    official: z
      .object({
        appIdEnv: envName.default(ENV_KEYS.QQ_BOT_APP_ID),
        appSecretEnv: envName.default(ENV_KEYS.QQ_BOT_APP_SECRET),
        sandbox: z.boolean().default(false),
      })
      .strict(),
    groups: z
      .record(
        z.string().regex(/^[1-9]\d*$/),
        z.object({ openid: z.string().trim().min(1), name: z.string().min(1).optional() }),
      )
      .default({}),
  })
  .strict()
  .transform(({ official, ...account }) => ({ ...account, ...official }));
const rootSchema = z.object({ accounts: z.array(z.union([napcatSchema, officialSchema])).min(1) });

export type NapcatAccountConfig = z.infer<typeof napcatSchema>;
export type OfficialAccountConfig = z.infer<typeof officialSchema>;
export type QQAccountConfig = NapcatAccountConfig | OfficialAccountConfig;
export interface ParsedQQConfig {
  provider: "official" | "napcat" | "mixed";
  accounts: QQAccountConfig[];
}

/** 只接受顶层 accounts，连接参数在对应通道子段中，统一归一化供业务层使用。 */
export function parseQQConfig(config: unknown): ParsedQQConfig {
  const { accounts } = rootSchema.parse(config);
  const ids = new Set<string>();
  const envKeys = new Set<string>();
  for (const account of accounts) {
    if (ids.has(account.id)) throw new Error(`accounts 中存在重复的账号 id "${account.id}"。`);
    ids.add(account.id);
    if (account.provider !== "official") continue;
    for (const key of [account.appIdEnv, account.appSecretEnv]) {
      if (envKeys.has(key))
        throw new Error(`accounts 中凭据环境变量 ${key} 被重复使用，请为每个账号指定独立变量。`);
      envKeys.add(key);
    }
  }
  const providers = new Set(accounts.map((account) => account.provider));
  return { provider: providers.size > 1 ? "mixed" : accounts[0].provider, accounts };
}

/** CLI 缺省找第一个官方账号，显式指定 NapCat 时明确拒绝。 */
export function selectOfficialAccount(config: unknown, id?: string): OfficialAccountConfig {
  const { accounts } = parseQQConfig(config);
  const account = id
    ? accounts.find((entry) => entry.id === id)
    : accounts.find((entry) => entry.provider === "official");
  if (!account) throw new Error("未找到官方 QQ 账号，请先配置顶层 accounts。");
  if (account.provider !== "official")
    throw new Error(`账号 ${account.id} 使用 NapCat，不能执行官方 QQ 扫码或群发现操作。`);
  return account;
}
