export interface QQGroupSetting {
  id: string;
  name: string;
  openid: string | null;
  uses: string[];
}
export interface QQAccountSetting {
  id: string;
  name: string;
  groups: QQGroupSetting[];
  discovered: { openid: string; lastSeenAt: string }[];
}
export interface QQGroupsResponse {
  provider: "official" | "napcat" | "mixed";
  napcatAccounts: { id: string; name: string }[];
  accounts: QQAccountSetting[];
}
