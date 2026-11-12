import { readConfig, describeQQGroups, parseQQConfig } from "@nana/config";
import { readDiscoveredQQGroups } from "@nana/storage";
import type { QQGroupsResponse } from "../../shared/qq-groups.ts";

export function buildQQGroupsView(): QQGroupsResponse {
  const raw = readConfig();
  const qq = parseQQConfig(raw);
  return {
    provider: qq.provider,
    napcatAccounts: qq.accounts
      .filter((account) => account.provider === "napcat")
      .map((account) => ({ id: account.id, name: account.name ?? account.id })),
    accounts: describeQQGroups(raw).map((account) => ({
      ...account,
      discovered: readDiscoveredQQGroups(account.id).map((group) => ({
        openid: group.openid,
        lastSeenAt: group.lastSeenAt,
      })),
    })),
  };
}
