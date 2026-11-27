export type BotChannelStatus = "ok" | "degraded" | "error";

export interface BotChannelsSummary {
  status: BotChannelStatus;
  total: number;
  connected: number;
}

export interface BotControlStatusPayload {
  ok: true;
  uptimeSeconds: number;
  channels: BotChannelsSummary;
}

export interface BotStatusSnapshot {
  /** 已启用账号总数（含在线、离线、启动失败、缺凭据；不含已停用账号）。 */
  totalAccounts: number;
  /** 当前在线账号数。 */
  connectedAccounts: number;
  /** 进程启动时间戳（ms），缺省使用 process.uptime()。 */
  startedAt?: number;
}

/** 汇总已启用 QQ 账号在线态：全在线 ok、部分离线 degraded、全离线或无启用账号 error。 */
export function summarizeChannelStatus(total: number, connected: number): BotChannelStatus {
  if (total <= 0 || connected <= 0) return "error";
  return connected >= total ? "ok" : "degraded";
}

/** 构建脱敏的 bot 控制接口运行态响应，仅含粗粒度状态与汇总数字。 */
export function buildBotControlStatus(
  snapshot: BotStatusSnapshot,
  now: number = Date.now(),
): BotControlStatusPayload {
  const total = Math.max(0, Math.floor(snapshot.totalAccounts));
  const connected = Math.max(0, Math.min(total, Math.floor(snapshot.connectedAccounts)));
  const uptimeSeconds =
    snapshot.startedAt === undefined
      ? Math.max(0, Math.floor(process.uptime()))
      : Math.max(0, Math.floor((now - snapshot.startedAt) / 1000));
  return {
    ok: true,
    uptimeSeconds,
    channels: {
      status: summarizeChannelStatus(total, connected),
      total,
      connected,
    },
  };
}
