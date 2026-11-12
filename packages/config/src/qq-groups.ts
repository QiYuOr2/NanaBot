import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { NANA_CONFIG_FILE } from "@nana/constants";
import { resolveProjectRoot } from "@nana/utils";
import { parseQQConfig, type OfficialAccountConfig } from "./qq-schema.ts";

export interface QQGroupRow {
  id: string;
  openid: string | null;
  name: string;
  uses: string[];
}
export interface QQAccountGroups {
  id: string;
  name: string;
  groups: QQGroupRow[];
}

const targetsSchema = z.object({
  up: z
    .array(
      z.object({
        uname: z.string().default("主播"),
        qqAccount: z.string().optional(),
        liveMonitorConfig: z
          .object({ notifyGroups: z.array(z.number().int().positive()).default([]) })
          .optional(),
        wordcloud: z
          .object({ notifyGroups: z.array(z.number().int().positive()).default([]) })
          .optional(),
      }),
    )
    .default([]),
});

/** 枚举已配置与业务引用的群，包括尚未填写 openid 的群。无凭据读写。 */
export function describeQQGroups(config: unknown): QQAccountGroups[] {
  const qq = parseQQConfig(config);
  const { up } = targetsSchema.parse(config);
  return qq.accounts
    .filter((account): account is OfficialAccountConfig => account.provider === "official")
    .map((account) => {
      const groups = new Map<string, QQGroupRow>();
      const add = (id: string, use?: string) => {
        const mapping = account.groups[id];
        const row = groups.get(id) ?? {
          id,
          name: mapping?.name ?? "",
          openid: mapping?.openid ?? null,
          uses: [],
        };
        if (use && !row.uses.includes(use)) row.uses.push(use);
        groups.set(id, row);
      };
      for (const id of Object.keys(account.groups)) add(id);
      if (account.adminGroup) add(String(account.adminGroup), "管理群");
      for (const streamer of up) {
        if ((streamer.qqAccount ?? qq.defaultAccountId) !== account.id) continue;
        for (const id of streamer.liveMonitorConfig?.notifyGroups ?? [])
          add(String(id), `${streamer.uname} · 开播通知`);
        for (const id of streamer.wordcloud?.notifyGroups ?? [])
          add(String(id), `${streamer.uname} · 词云`);
      }
      return { id: account.id, name: account.name ?? account.id, groups: [...groups.values()] };
    });
}

/** 每次发送时读取映射，站点保存后无需重启机器人。 */
export function loadOfficialGroups(
  accountId: string,
  rootDir?: string,
): OfficialAccountConfig["groups"] {
  const text = readFileSync(join(resolveProjectRoot(rootDir), NANA_CONFIG_FILE), "utf8");
  const qq = parseQQConfig(parse(text));
  const account = qq.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error(`官方 QQ 账号 ${accountId} 已从配置移除，请重启 bot。`);
  if (account.provider !== "official")
    throw new Error(`账号 ${accountId} 的 QQ 通道已变更，请重启 bot 以应用通道配置。`);
  return account.groups;
}
