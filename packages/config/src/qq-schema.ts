import { ENV_KEYS } from "@nana/constants";
import { RE2JS } from "re2js";
import { z } from "zod";

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const scopeSchema = z
  .object({
    enabled: z.boolean().optional(),
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict();

export const messageRuleConfigSchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    type: z.enum(["exact", "contains", "startsWith", "regex"]),
    pattern: z.string().min(1).max(200),
    response: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    ignoreCase: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.type === "regex") {
      try {
        RE2JS.compile(
          rule.pattern,
          rule.ignoreCase || rule.caseSensitive === false ? RE2JS.CASE_INSENSITIVE : 0,
        );
      } catch {
        context.addIssue({ code: "custom", path: ["pattern"], message: "正则表达式无效" });
      }
    }
  });

export const messageConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    commands: z
      .object({
        enabled: z.boolean().optional(),
        prefix: z.string().min(1).max(8).optional(),
        aliases: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    commandAliases: z.record(z.string(), z.array(z.string())).optional(),
    rules: z
      .object({
        enabled: z.boolean().optional(),
        stopOnFirstMatch: z.boolean().optional(),
        items: z.array(messageRuleConfigSchema).max(100).optional(),
      })
      .strict()
      .optional(),
    admins: z
      .object({ users: z.array(z.string()).optional(), groups: z.array(z.string()).optional() })
      .strict()
      .optional(),
    scopes: z
      .object({ group: scopeSchema.optional(), private: scopeSchema.optional() })
      .strict()
      .optional(),
    cooldown: z
      .object({
        enabled: z.boolean().optional(),
        commandUserMs: z.number().int().nonnegative().optional(),
        ruleUserMs: z.number().int().nonnegative().optional(),
        ruleConversationMs: z.number().int().nonnegative().optional(),
        userMs: z.number().int().nonnegative().optional(),
        conversationMs: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((message, context) => {
    const aliasOwners = new Map<string, string>();
    const configuredAliases = {
      ...message.commands?.aliases,
      ...message.commandAliases,
    } as Record<string, string | string[]>;
    for (const [command, rawAliases] of Object.entries(configuredAliases)) {
      if (!["status", "help", "live"].includes(command.toLowerCase())) {
        context.addIssue({
          code: "custom",
          path: ["commandAliases", command],
          message: "别名目标必须是 status、help 或 live",
        });
      }
      for (const alias of Array.isArray(rawAliases) ? rawAliases : [rawAliases]) {
        const normalized = alias.toLowerCase();
        if (
          ["status", "help", "live", "状态", "帮助", "直播"].includes(normalized) ||
          aliasOwners.has(normalized)
        ) {
          context.addIssue({
            code: "custom",
            path: ["commandAliases", command],
            message: `别名 "${alias}" 重复或与内置命令冲突`,
          });
        }
        aliasOwners.set(normalized, command);
      }
    }
    const ruleIds = new Set<string>();
    for (const [index, rule] of (message.rules?.items ?? []).entries()) {
      if (ruleIds.has(rule.id)) {
        context.addIssue({
          code: "custom",
          path: ["rules", "items", index, "id"],
          message: `规则 ID "${rule.id}" 重复`,
        });
      }
      ruleIds.add(rule.id);
    }
  });

const common = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  adminGroup: z.number().int().positive().optional(),
  message: messageConfigSchema.optional(),
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

const rootSchema = z
  .object({ accounts: z.array(z.union([napcatSchema, officialSchema])).min(1) })
  .passthrough()
  .superRefine((config, context) => {
    if (config.message === undefined) return;
    const result = messageConfigSchema.safeParse(config.message);
    if (result.success) return;
    for (const issue of result.error.issues) {
      context.addIssue({
        code: "custom",
        path: ["message", ...issue.path],
        message: issue.message,
      });
    }
  });

export type NapcatAccountConfig = z.infer<typeof napcatSchema>;
export type OfficialAccountConfig = z.infer<typeof officialSchema>;
export type QQAccountConfig = NapcatAccountConfig | OfficialAccountConfig;
export interface ParsedQQConfig {
  provider: "official" | "napcat" | "mixed";
  accounts: QQAccountConfig[];
}

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
