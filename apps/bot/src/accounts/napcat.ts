import { readConfig, parseNapcatAccountConfigs, type NapcatAccountConfig } from "@nana/config";
import { DEFAULT_NC_WS_URL, ENV_KEYS } from "@nana/constants";

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

  return configured.map((entry) => resolveNapcatAccount(entry, env));
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
  const accounts = [resolveNapcatAccount(primary, env)];
  const unavailable: UnavailableNapcatAccount[] = [];

  for (const entry of secondary) {
    try {
      accounts.push(resolveNapcatAccount(entry, env));
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

function readConfiguredAccounts(config: unknown): NapcatAccountConfig[] | undefined {
  const entries = parseNapcatAccountConfigs(config);
  return entries.length ? entries : undefined;
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

export function resolveNapcatAccount(
  entry: NapcatAccountConfig,
  env: NodeJS.ProcessEnv,
): NapcatAccount {
  const envKey = entry.accessTokenEnv ?? ENV_KEYS.NC_ACCESS_TOKEN;
  const accessToken = entry.accessToken ?? env[envKey];
  if (!accessToken) {
    throw new Error(
      `NapCat 账号 "${entry.id}" 缺少 access token：请在 .env 中设置 ${envKey}，或在对应账号的 NapCat 配置中填写 accessToken。`,
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

function resolveWsUrl(entry: NapcatAccountConfig, env: NodeJS.ProcessEnv): string {
  if (entry.wsUrl) {
    return entry.wsUrl;
  }

  if (entry.wsUrlEnv) {
    const wsUrl = env[entry.wsUrlEnv];
    if (!wsUrl) {
      throw new Error(
        `NapCat 账号 "${entry.id}" 缺少 WebSocket 地址：请在 .env 中设置 ${entry.wsUrlEnv}，或在对应账号的 NapCat 配置中填写 wsUrl。`,
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
