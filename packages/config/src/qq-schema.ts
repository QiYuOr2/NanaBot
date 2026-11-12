import { ENV_KEYS } from "@nana/constants";
import { z } from "zod";

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const common = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).optional(),
  adminGroup: z.number().int().positive().optional(),
});
const napcatSchema = common.extend({
  provider: z.literal("napcat").default("napcat"),
  wsUrl: z.string().min(1).optional(),
  wsUrlEnv: envName.optional(),
  accessToken: z.string().min(1).optional(),
  accessTokenEnv: envName.optional(),
});
const officialSchema = common.extend({
  provider: z.literal("official").default("official"),
  appIdEnv: envName.default(ENV_KEYS.QQ_BOT_APP_ID),
  appSecretEnv: envName.default(ENV_KEYS.QQ_BOT_APP_SECRET),
  sandbox: z.boolean().default(false),
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
const rootSchema = z.object({
  qq: z
    .object({
      provider: z.enum(["napcat", "official"]).optional(),
      defaultAccount: z.string().min(1).optional(),
      accounts: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .optional(),
});

export type NapcatAccountConfig = z.infer<typeof napcatSchema>;
export type OfficialAccountConfig = z.infer<typeof officialSchema>;
export type QQAccountConfig = NapcatAccountConfig | OfficialAccountConfig;
export interface ParsedQQConfig {
  provider: "official" | "napcat" | "mixed";
  accounts: QQAccountConfig[];
  defaultAccountId: string;
  source: "accounts" | "legacy-napcat";
}

/** 兼容旧 napcat.accounts；配置校验只在入口做一次，凭据仍由 bot 读取。 */
export function parseNapcatAccountConfigs(config: unknown): NapcatAccountConfig[] {
  const raw = z
    .object({ napcat: z.object({ accounts: z.array(napcatSchema).default([]) }).optional() })
    .parse(config);
  const accounts = raw.napcat?.accounts ?? [];
  assertUniqueIds(accounts, "napcat.accounts");
  return accounts;
}

export function parseQQConfig(config: unknown): ParsedQQConfig {
  const { qq } = rootSchema.parse(config);
  const entries = qq?.accounts ?? [];
  const explicitProviders = entries.some((entry) => entry.provider !== undefined);
  // 旧版全局切回 NapCat 的行为保留；新配置按每个账号自己的 provider 分派。
  if (!entries.length || (qq?.provider === "napcat" && !explicitProviders)) {
    if (qq?.provider === "official") throw new Error("官方 QQ 通道需要配置 qq.accounts。");
    const legacy = parseNapcatAccountConfigs(config);
    const accounts: QQAccountConfig[] = legacy.length
      ? legacy
      : [{ id: "default", provider: "napcat" }];
    return {
      provider: "napcat",
      accounts,
      defaultAccountId: defaultId(accounts, qq?.defaultAccount),
      source: "legacy-napcat",
    };
  }
  const accounts = entries.map((entry): QQAccountConfig => {
    const provider = entry.provider ?? qq?.provider ?? "official";
    if (provider !== "official" && provider !== "napcat")
      throw new Error(`QQ 账号 ${String(entry.id)} 的 provider 必须为 official 或 napcat。`);
    const block = entry[provider];
    if (block !== undefined && (!block || typeof block !== "object" || Array.isArray(block))) {
      throw new Error(`QQ 账号 ${String(entry.id)} 的 ${provider} 连接配置必须是对象。`);
    }
    const other = provider === "official" ? "napcat" : "official";
    if (entry[other] !== undefined)
      throw new Error(
        `QQ 账号 ${String(entry.id)} 选择了 ${provider}，不能包含 ${other} 连接配置。`,
      );
    const merged = {
      ...entry,
      ...(block as Record<string, unknown> | undefined),
      id: entry.id,
      name: entry.name,
      adminGroup: entry.adminGroup,
      provider,
      groups: entry.groups,
    };
    return provider === "official" ? officialSchema.parse(merged) : napcatSchema.parse(merged);
  });
  assertUniqueIds(accounts, "qq.accounts");
  const envKeys = new Set<string>();
  for (const account of accounts) {
    if (account.provider !== "official") continue;
    for (const key of [account.appIdEnv, account.appSecretEnv]) {
      if (envKeys.has(key))
        throw new Error(`qq.accounts 中凭据环境变量 ${key} 被重复使用，请为每个账号指定独立变量。`);
      envKeys.add(key);
    }
  }
  const providers = new Set(accounts.map((account) => account.provider));
  return {
    provider: providers.size > 1 ? "mixed" : accounts[0].provider,
    accounts,
    defaultAccountId: defaultId(accounts, qq?.defaultAccount),
    source: "accounts",
  };
}

/** CLI 选择官方账号共用入口：缺省找第一个官方账号，显式指定 NapCat 时明确拒绝。 */
export function selectOfficialAccount(config: unknown, id?: string): OfficialAccountConfig {
  const qq = parseQQConfig(config);
  const account = id
    ? qq.accounts.find((entry) => entry.id === id)
    : qq.accounts.find((entry) => entry.provider === "official");
  if (!account) throw new Error("未找到官方 QQ 账号，请先配置 qq.accounts。");
  if (account.provider !== "official")
    throw new Error(`账号 ${account.id} 使用 NapCat，不能执行官方 QQ 扫码或群发现操作。`);
  return account;
}

function assertUniqueIds(accounts: readonly { id: string }[], section: string) {
  const ids = new Set<string>();
  for (const account of accounts) {
    if (ids.has(account.id)) throw new Error(`${section} 中存在重复的账号 id "${account.id}"。`);
    ids.add(account.id);
  }
}
function defaultId(accounts: readonly { id: string }[], requested?: string): string {
  const id = requested ?? accounts[0].id;
  if (!accounts.some((entry) => entry.id === id))
    throw new Error(`默认 QQ 账号 "${id}" 未在当前账号列表中定义。`);
  return id;
}
