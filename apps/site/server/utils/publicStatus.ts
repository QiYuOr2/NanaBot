import { BOT_CONTROL_DEFAULT_URL, BOT_CONTROL_STATUS_PATH, ENV_KEYS } from "@nana/constants";
import { checkStorageHealth } from "@nana/storage";
import { readAppEnvValue } from "@nana/utils";
import type {
  PublicStatusChecks,
  PublicStatusResponse,
  StatusCheckResult,
} from "../../shared/status.ts";

export const BOT_STATUS_PROBE_TIMEOUT_MS = 2_500;

export interface ReadPublicStatusOptions {
  rootDir?: string;
  controlUrl?: string;
  timeoutMs?: number;
  uptimeSeconds?: () => number;
}

export interface PublicStatusProbeResult {
  statusCode: 200 | 503;
  body: PublicStatusResponse;
}

function isValidChannelStatus(value: unknown): value is StatusCheckResult {
  return value === "ok" || value === "degraded" || value === "error";
}

async function probeBotAndChannels(
  controlUrl: string,
  timeoutMs: number,
): Promise<{ bot: "ok" | "error"; channels: StatusCheckResult }> {
  try {
    const response = await fetch(`${controlUrl}${BOT_CONTROL_STATUS_PATH}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { bot: "error", channels: "error" };
    const payload = (await response.json().catch(() => undefined)) as
      | { ok?: unknown; channels?: { status?: unknown } }
      | undefined;
    const channelStatus = payload?.channels?.status;
    if (payload?.ok !== true || !isValidChannelStatus(channelStatus)) {
      return { bot: "error", channels: "error" };
    }
    return { bot: "ok", channels: channelStatus };
  } catch {
    return { bot: "error", channels: "error" };
  }
}

/** 采集脱敏后的公开服务可用性状态，供外部状态页探针调用。 */
export async function readPublicStatus(
  options?: ReadPublicStatusOptions,
): Promise<PublicStatusProbeResult> {
  const controlUrl = (
    options?.controlUrl ||
    readAppEnvValue("site", ENV_KEYS.NANA_BOT_CONTROL_URL, options?.rootDir) ||
    BOT_CONTROL_DEFAULT_URL
  ).replace(/\/+$/u, "");
  const timeoutMs = options?.timeoutMs ?? BOT_STATUS_PROBE_TIMEOUT_MS;

  const botProbePromise = probeBotAndChannels(controlUrl, timeoutMs);
  const storage: "ok" | "error" = checkStorageHealth(
    options?.rootDir ? { rootDir: options.rootDir } : undefined,
  )
    ? "ok"
    : "error";
  const botProbe = await botProbePromise;

  const checks: PublicStatusChecks = {
    bot: botProbe.bot,
    channels: botProbe.channels,
    storage,
  };
  const healthy = checks.bot === "ok" && checks.channels === "ok" && checks.storage === "ok";
  const uptime = (options?.uptimeSeconds ?? process.uptime)();

  return {
    statusCode: healthy ? 200 : 503,
    body: {
      status: healthy ? "ok" : "degraded",
      uptimeSeconds: Number.isFinite(uptime) ? Math.max(0, Math.floor(uptime)) : 0,
      checks,
    },
  };
}
