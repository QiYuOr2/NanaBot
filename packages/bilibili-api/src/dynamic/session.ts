import { BilibiliDynamicError } from "./errors.ts";
import { fetchJson, type HttpJsonResult } from "./http.ts";
import { extractWbiKeyFromUrl, type WbiKeys } from "./wbi.ts";
import type { RawNavResponse } from "./types.ts";

const NAV_PATH = "/x/web-interface/nav";
const WBI_KEY_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 需要保留的匿名 Cookie 名。响应带回的其余 Cookie（含登录态）一律丢弃，避免误用用户凭据。
 * 登录态只允许来自调用方显式配置（见 {@link WbiSession} 的 staticCookies），绝不从响应吸收。
 * 移植自 Boku `session.go` 的 `anonymousCookie`。
 */
const ANONYMOUS_COOKIE_NAMES: ReadonlySet<string> = new Set([
  "buvid3",
  "buvid4",
  "b_nut",
  "buvid_fp",
  "_uuid",
  "b_lsid",
]);

/** 浏览器身份请求头；UA 与 sec-ch-ua 的版本必须一致，避免指纹异常。 */
export function browserHeaders(cookieHeader?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Origin: "https://www.bilibili.com",
    Referer: "https://www.bilibili.com/",
    "sec-ch-ua": '"Not;A=Brand";v="99", "Google Chrome";v="138", "Chromium";v="138"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    priority: "u=1, i",
  };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  return headers;
}

/** 解析原始 Cookie 头字符串为名值表（跳过无等号的片段）。 */
export function parseCookieHeader(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && value) map.set(name, value);
  }
  return map;
}

/**
 * 会话：维护 Cookie、缓存 WBI key，并在需要时刷新。
 *
 * Cookie 有两个来源：响应带回的匿名 Cookie（白名单吸收），与调用方显式配置的
 * 静态 Cookie（登录态，来自 `DynamicFeedOptions.cookie`）。同名时响应吸收的值优先
 * （如 buvid 会被服务端刷新）；登录态的名字不在吸收白名单内，不会被覆盖或丢弃。
 */
export class WbiSession {
  private readonly cookies = new Map<string, string>();
  private readonly staticCookies: ReadonlyMap<string, string>;
  private cachedKeys: WbiKeys | undefined;
  private keysTime = 0;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly webBaseUrl: string,
    private readonly fetchImpl: typeof globalThis.fetch,
    private readonly timeoutMs: number,
    private readonly now: () => number,
    cookieHeader?: string,
  ) {
    this.staticCookies = cookieHeader ? parseCookieHeader(cookieHeader) : new Map();
  }

  /** 是否配置了登录态 Cookie（只报有无，绝不报值）。 */
  get hasStaticCookies(): boolean {
    return this.staticCookies.size > 0;
  }

  /** 当前 Cookie 头（静态配置与吸收值合并，按名排序，保持稳定）。 */
  cookieHeader(): string {
    const merged = new Map([...this.staticCookies, ...this.cookies]);
    return [...merged.keys()]
      .sort()
      .map((name) => `${name}=${merged.get(name)}`)
      .join("; ");
  }

  /** 吸收响应返回的 Set-Cookie，仅保留匿名白名单内的键。 */
  absorb(setCookies: readonly string[]): void {
    for (const pair of setCookies) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || !value || !ANONYMOUS_COOKIE_NAMES.has(name)) continue;
      this.cookies.set(name, value);
    }
  }

  /** 构造带浏览器身份与当前 Cookie 的请求头。 */
  headers(): Record<string, string> {
    return browserHeaders(this.cookieHeader());
  }

  /** 若尚无匿名 Cookie，则访问 Web 站根（而非 API 域）以获取 buvid3 等初始 Cookie。 */
  async ensureCookies(): Promise<void> {
    if (this.cookies.size > 0) return;
    try {
      const result = await fetchJson(`${this.webBaseUrl}/`, {
        fetch: this.fetchImpl,
        headers: browserHeaders(),
        timeoutMs: this.timeoutMs,
      });
      this.absorb(result.setCookies);
    } catch {
      // Cookie 初始化失败不致命：请求可能仍可用，交由实际接口请求暴露真实错误。
    }
  }

  /** 清除缓存的 WBI key，下一次取用时强制刷新（用于 -352 后自愈）。 */
  invalidateKeys(): void {
    this.cachedKeys = undefined;
    this.keysTime = 0;
  }

  /** 取得可用的 WBI key；未过期直接复用，过期则刷新，刷新失败时沿用旧的可用 key。 */
  async getKeys(): Promise<WbiKeys> {
    if (this.cachedKeys && this.now() - this.keysTime < WBI_KEY_TTL_MS) {
      return this.cachedKeys;
    }
    try {
      const keys = await this.fetchKeys();
      this.cachedKeys = keys;
      this.keysTime = this.now();
      return keys;
    } catch (error) {
      if (this.cachedKeys) return this.cachedKeys;
      throw error;
    }
  }

  /** 请求 nav 接口并解析 img/sub key。code 常为 -101（未登录），不据此判失败。 */
  private async fetchKeys(): Promise<WbiKeys> {
    await this.ensureCookies();
    const result: HttpJsonResult = await fetchJson(`${this.apiBaseUrl}${NAV_PATH}`, {
      fetch: this.fetchImpl,
      headers: this.headers(),
      timeoutMs: this.timeoutMs,
    });
    this.absorb(result.setCookies);
    if (result.status < 200 || result.status >= 300) {
      throw new BilibiliDynamicError(
        `获取 WBI key 失败：HTTP ${result.status}`,
        "http",
        result.status,
      );
    }
    const body = result.json as RawNavResponse | undefined;
    const imgUrl = body?.data?.wbi_img?.img_url;
    const subUrl = body?.data?.wbi_img?.sub_url;
    if (!imgUrl || !subUrl) {
      throw new BilibiliDynamicError("nav 响应缺少 WBI key", "parse");
    }
    const imgKey = extractWbiKeyFromUrl(imgUrl);
    const subKey = extractWbiKeyFromUrl(subUrl);
    if (!imgKey || !subKey) {
      throw new BilibiliDynamicError("nav 响应中的 WBI key 为空", "parse");
    }
    return { imgKey, subKey };
  }
}
