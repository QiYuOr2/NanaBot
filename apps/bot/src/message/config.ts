import { messageConfigSchema } from "@nana/config";
import type { MessageConfig } from "./types.ts";

const resolvedMessageConfigSchema = messageConfigSchema.transform((input) => ({
  enabled: input.enabled ?? true,
  commands: {
    enabled: input.commands?.enabled ?? true,
    prefix: input.commands?.prefix ?? "/",
    aliases: Object.fromEntries(
      Object.entries({
        ...Object.fromEntries(
          Object.entries(input.commands?.aliases ?? {}).map(([command, alias]) => [
            command,
            [alias],
          ]),
        ),
        ...input.commandAliases,
      }).flatMap(([command, aliases]) =>
        (aliases as string[]).map((alias) => [alias.toLowerCase(), command]),
      ),
    ),
  },
  rules: {
    enabled: input.rules?.enabled ?? false,
    stopOnFirstMatch: input.rules?.stopOnFirstMatch ?? true,
    items: (input.rules?.items ?? []).map((rule) => ({
      id: rule.id,
      enabled: rule.enabled ?? true,
      type: rule.type,
      pattern: rule.pattern,
      ignoreCase: rule.ignoreCase ?? rule.caseSensitive === false,
      response: rule.response,
    })),
  },
  admins: { users: input.admins?.users ?? [], groups: input.admins?.groups ?? [] },
  scopes: {
    group: {
      enabled: input.scopes?.group?.enabled ?? true,
      allow: input.scopes?.group?.allow ?? [],
      deny: input.scopes?.group?.deny ?? [],
    },
    private: {
      enabled: input.scopes?.private?.enabled ?? true,
      allow: input.scopes?.private?.allow ?? [],
      deny: input.scopes?.private?.deny ?? [],
    },
  },
  cooldown: {
    enabled: input.cooldown?.enabled ?? true,
    commandUserMs: input.cooldown?.commandUserMs ?? 3000,
    ruleUserMs: input.cooldown?.ruleUserMs ?? input.cooldown?.userMs ?? 3000,
    ruleConversationMs:
      input.cooldown?.ruleConversationMs ?? input.cooldown?.conversationMs ?? 1000,
  },
}));

function mergeSection(base: unknown, override: unknown): Record<string, unknown> | undefined {
  if (!base && !override) return undefined;
  if (base && typeof base === "object" && override && typeof override === "object") {
    return { ...base, ...override };
  }
  return (override ?? base) as Record<string, unknown>;
}

export function mergeMessageConfig(globalConfig: unknown, accountConfig?: unknown): MessageConfig {
  const globalValue = (
    globalConfig && typeof globalConfig === "object" ? globalConfig : {}
  ) as Record<string, unknown>;
  const accountValue = (
    accountConfig && typeof accountConfig === "object" ? accountConfig : {}
  ) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...globalValue, ...accountValue };
  for (const section of ["commands", "rules", "admins", "cooldown"]) {
    const value = mergeSection(globalValue[section], accountValue[section]);
    if (value) merged[section] = value;
  }
  const globalScopes = (globalValue.scopes ?? {}) as Record<string, unknown>;
  const accountScopes = (accountValue.scopes ?? {}) as Record<string, unknown>;
  merged.scopes = {
    ...globalScopes,
    ...accountScopes,
    group: mergeSection(globalScopes.group, accountScopes.group) ?? {},
    private: mergeSection(globalScopes.private, accountScopes.private) ?? {},
  };
  const result = resolvedMessageConfigSchema.safeParse(merged);
  if (!result.success)
    throw new Error(
      `message 配置无效：${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  return result.data;
}

export const parseMessageConfig = mergeMessageConfig;
