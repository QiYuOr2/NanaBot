import { readConfig } from "@nana/config";
import { DEFAULT_NC_WS_URL, ENV_KEYS } from "@nana/constants";
import { z } from "zod";

/** 一个 NapCat 实例对应一个 QQ 号。 */
export interface NapcatAccount {
  /** 配置里引用账号的稳定标识，例如 `main` / `second`。 */
  id: string;
  /** 日志与通知里的展示名。 */
  name: string;
  wsUrl: string;
  accessToken: string;
  adminGroupId?: number;
}

/** 配置存在、但当前缺少连接变量而无法启动的账号。 */
export interface UnavailableNapcatAccount {
  id: string;
  name: string;
  error: Error;
}

export interface NapcatAccountSet {
  accounts: NapcatAccount[];
  unavailable: UnavailableNapcatAccount[];
}

/** 至少带主播名与可选的账号归属，用于把主播分配到账号。 */
export interface AccountAssignableStreamer {
  streamer: string;
  qqAccount?: string;
}

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const NapcatAccountSchema = z.object({
  id: z.string().regex(ACCOUNT_ID_PATTERN, "NapCat 账号 id 只能包含字母、数字、下划线和短横线"),
  name: z.string().min(1).optional(),
  /** 省略时沿用 `NC_WS_URL`（再缺省则用库的默认地址）。 */
  wsUrl: z.string().min(1).optional(),
  /** wsUrl 所在的环境变量名；配置后不再回退 `NC_WS_URL`。 */
  wsUrlEnv: z.string().min(1).optional(),
  /** 直接写 token（不推荐）；与 `accessTokenEnv` 同时存在时优先使用它。 */
  accessToken: z.string().min(1).optional(),
  /** token 所在的环境变量名；缺省为 `NC_ACCESS_TOKEN`。 */
  accessTokenEnv: z.string().min(1).optional(),
  adminGroup: z.number().int().positive().optional(),
});

const NapcatConfigSchema = z.object({
  napcat: z
    .object({
      accounts: z.array(NapcatAccountSchema).optional(),
    })
    .optional(),
});

type NapcatAccountInput = z.infer<typeof NapcatAccountSchema>;

/**
 * 解析 `nana.config.yaml#napcat.accounts`。
 *
 * 没有配置账号时回退到旧版单账号环境变量，保证已有部署不需要改配置。
 * 入口文件和测试都通过这个函数读取账号，避免两套解析逻辑。
 */
export function parseNapcatAccounts(
  config: unknown,
  env: NodeJS.ProcessEnv = process.env,
): NapcatAccount[] {
  const configured = readConfiguredAccounts(config);
  if (!configured) {
    return [legacyAccount(env)];
  }

  return configured.map((entry) => toNapcatAccount(entry, env));
}

/**
 * 解析可启动账号与暂不可用账号。
 *
 * 第一个账号是主账号，配置错误时直接失败；后续账号缺少 `wsUrlEnv` /
 * `accessTokenEnv` 对应的变量时只跳过自己，保证主号仍能上线并处理其它实例未启动的场景。
 */
export function resolveNapcatAccounts(
  config: unknown,
  env: NodeJS.ProcessEnv = process.env,
): NapcatAccountSet {
  const configured = readConfiguredAccounts(config);
  if (!configured) {
    return { accounts: [legacyAccount(env)], unavailable: [] };
  }

  const [primary, ...secondary] = configured;
  const accounts = [toNapcatAccount(primary, env)];
  const unavailable: UnavailableNapcatAccount[] = [];

  for (const entry of secondary) {
    try {
      accounts.push(toNapcatAccount(entry, env));
    } catch (error) {
      unavailable.push({
        id: entry.id,
        name: entry.name ?? entry.id,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  return { accounts, unavailable };
}

/** 从项目配置读取 NapCat 账号列表。 */
export function loadNapcatAccounts(env: NodeJS.ProcessEnv = process.env): NapcatAccount[] {
  return parseNapcatAccounts(readConfig(), env);
}

/** 从项目配置读取主账号与暂不可用的后续账号。 */
export function loadNapcatAccountSet(env: NodeJS.ProcessEnv = process.env): NapcatAccountSet {
  return resolveNapcatAccounts(readConfig(), env);
}

/**
 * 按 `up[].qqAccount` 把主播分配到账号。
 *
 * 未写 `qqAccount` 的主播落在第一个账号，保持旧配置继续工作；
 * 写了但不存在的账号直接报错，避免通知静默发错号。
 */
export function groupStreamersByAccount<T extends AccountAssignableStreamer>(
  streamers: readonly T[],
  accounts: readonly NapcatAccount[],
  options: { skipAccountIds?: ReadonlySet<string> } = {},
): Map<string, T[]> {
  const [defaultAccount] = accounts;
  if (!defaultAccount) {
    throw new Error("至少需要配置一个 NapCat 账号。");
  }

  const groups = new Map(accounts.map((account) => [account.id, [] as T[]]));
  for (const streamer of streamers) {
    const accountId = streamer.qqAccount ?? defaultAccount.id;
    const group = groups.get(accountId);
    if (options.skipAccountIds?.has(accountId)) {
      continue;
    }
    if (!group) {
      throw new Error(
        `主播 "${streamer.streamer}" 的 qqAccount "${accountId}" 未在 napcat.accounts 中定义。`,
      );
    }
    group.push(streamer);
  }

  return groups;
}

function readConfiguredAccounts(config: unknown): NapcatAccountInput[] | undefined {
  const parsed = NapcatConfigSchema.parse(config);
  const configured = parsed.napcat?.accounts ?? [];
  if (configured.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  for (const entry of configured) {
    if (seen.has(entry.id)) {
      throw new Error(`napcat.accounts 中存在重复的账号 id "${entry.id}"。`);
    }
    seen.add(entry.id);
  }

  return configured;
}

function legacyAccount(env: NodeJS.ProcessEnv): NapcatAccount {
  const accessToken = env[ENV_KEYS.NC_ACCESS_TOKEN];
  if (!accessToken) {
    throw new Error(
      `未配置 NapCat 账号：请在 nana.config.yaml 中添加 napcat.accounts，或在 .env 中设置 ${ENV_KEYS.NC_ACCESS_TOKEN}。`,
    );
  }

  return {
    id: "default",
    name: "默认账号",
    wsUrl: env[ENV_KEYS.NC_WS_URL] ?? DEFAULT_NC_WS_URL,
    accessToken,
    adminGroupId: parseOptionalNumber(env[ENV_KEYS.ADM_GROUP], ENV_KEYS.ADM_GROUP),
  };
}

function toNapcatAccount(entry: NapcatAccountInput, env: NodeJS.ProcessEnv): NapcatAccount {
  const envKey = entry.accessTokenEnv ?? ENV_KEYS.NC_ACCESS_TOKEN;
  const accessToken = entry.accessToken ?? env[envKey];
  if (!accessToken) {
    throw new Error(
      `NapCat 账号 "${entry.id}" 缺少 access token：请在 .env 中设置 ${envKey}，或在 napcat.accounts 中填写 accessToken。`,
    );
  }

  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    wsUrl: resolveWsUrl(entry, env),
    accessToken,
    // 多账号必须各自显式指定管理群；否则会全部落到同一个 ADM_GROUP。
    adminGroupId: entry.adminGroup,
  };
}

function resolveWsUrl(entry: NapcatAccountInput, env: NodeJS.ProcessEnv): string {
  if (entry.wsUrl) {
    return entry.wsUrl;
  }

  if (entry.wsUrlEnv) {
    const wsUrl = env[entry.wsUrlEnv];
    if (!wsUrl) {
      throw new Error(
        `NapCat 账号 "${entry.id}" 缺少 WebSocket 地址：请在 .env 中设置 ${entry.wsUrlEnv}，或在 napcat.accounts 中填写 wsUrl。`,
      );
    }
    return wsUrl;
  }

  return env[ENV_KEYS.NC_WS_URL] ?? DEFAULT_NC_WS_URL;
}

function parseOptionalNumber(value: string | undefined, key: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} 必须是有效数字。`);
  }
  return parsed;
}
