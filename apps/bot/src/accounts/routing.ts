/** 至少带主播名与可选的账号归属，用于把主播分配到账号。 */
export interface AccountAssignableStreamer {
  streamer: string;
  qqAccount?: string;
}

/**
 * 按 `up[].qqAccount` 把主播分配到账号。
 *
 * 未写 `qqAccount` 的主播落在配置的默认账号，缺省为第一个账号；
 * 写了但不存在的账号直接报错，避免通知静默发错号。
 */
export function groupStreamersByAccount<T extends AccountAssignableStreamer>(
  streamers: readonly T[],
  accounts: readonly { id: string }[],
  options: { skipAccountIds?: ReadonlySet<string>; defaultAccountId?: string } = {},
): Map<string, T[]> {
  const [defaultAccount] = accounts;
  if (!defaultAccount) {
    throw new Error("至少需要配置一个 QQ 账号。");
  }

  const groups = new Map(accounts.map((account) => [account.id, [] as T[]]));
  for (const streamer of streamers) {
    const accountId = streamer.qqAccount ?? options.defaultAccountId ?? defaultAccount.id;
    const group = groups.get(accountId);
    if (options.skipAccountIds?.has(accountId)) {
      continue;
    }
    if (!group) {
      throw new Error(
        `主播 "${streamer.streamer}" 的 qqAccount "${accountId}" 未在当前通道的账号列表（napcat.accounts / qq.accounts）中定义。`,
      );
    }
    group.push(streamer);
  }

  return groups;
}
