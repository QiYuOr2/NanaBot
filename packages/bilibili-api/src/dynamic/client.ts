import { WbiSession } from "./session.ts";
import { signWbiParams } from "./wbi.ts";
import { BilibiliDynamicError } from "./errors.ts";
import { fetchJson } from "./http.ts";
import { parseDynamicFeed } from "./parser.ts";
import type { BilibiliDynamic, DynamicFeedOptions, RawDynamicFeedResponse } from "./types.ts";

const DEFAULT_API_BASE_URL = "https://api.bilibili.com";
const DEFAULT_WEB_BASE_URL = "https://www.bilibili.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_EMPTY_RETRIES = 3;
const DEFAULT_EMPTY_RETRY_DELAY_MS = 400;

const DYNAMIC_FEED_PATH = "/x/polymer/web-dynamic/v1/feed/space";
/** 签名失效业务码：刷新 WBI key 后有限重试。 */
const SIGNATURE_EXPIRED_CODE = -352;
/** 风控 / 封禁业务码：不重试、不视为空。 */
const RISK_CONTROL_CODES: ReadonlySet<number> = new Set([-412]);

/** 动态 Feed 客户端：封装匿名会话、WBI 签名、风控/签名错误分类和空列表重试。 */
export class BilibiliDynamicClient {
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly emptyRetries: number;
  private readonly emptyRetryDelayMs: number;
  private readonly now: () => number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly session: WbiSession;

  constructor(options: DynamicFeedOptions = {}) {
    this.apiBaseUrl = options.baseUrl ?? DEFAULT_API_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.emptyRetries = Math.max(1, options.emptyRetries ?? DEFAULT_EMPTY_RETRIES);
    this.emptyRetryDelayMs = options.emptyRetryDelayMs ?? DEFAULT_EMPTY_RETRY_DELAY_MS;
    this.now = options.now ?? Date.now;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("当前运行环境不支持 fetch，请传入 DynamicFeedOptions.fetch。");
    }
    this.fetchImpl = fetchImpl;
    this.session = new WbiSession(
      this.apiBaseUrl,
      options.webBaseUrl ?? DEFAULT_WEB_BASE_URL,
      fetchImpl,
      this.timeoutMs,
      this.now,
      options.cookie,
    );
  }

  /**
   * 拉取指定 UID 的最近动态。
   *
   * 空列表重试：B 站对限流的匿名请求可能返回 `code:0` + 空 `items`，与「确实没有动态」
   * 无法区分。因此空列表最多重试 `emptyRetries` 次；全部为空才返回空数组。
   * **任何错误（网络/HTTP/风控/签名/解析）都以异常抛出，绝不伪装成空数组。**
   */
  async fetchUserDynamics(uid: number, limit = 20): Promise<BilibiliDynamic[]> {
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new TypeError(`uid 必须是正整数：${uid}`);
    }

    let lastEmpty: RawDynamicFeedResponse | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < this.emptyRetries; attempt += 1) {
      if (attempt > 0) {
        await delay(this.emptyRetryDelayMs);
      }

      let body: RawDynamicFeedResponse;
      try {
        body = await this.requestFeed(uid);
      } catch (error) {
        if (error instanceof BilibiliDynamicError && error.kind === "signature") {
          // 签名失效：刷新 key 后继续下一轮。
          this.session.invalidateKeys();
          lastError = error;
          continue;
        }
        if (
          error instanceof BilibiliDynamicError &&
          (error.kind === "risk-control" || error.kind === "http" || error.kind === "parse")
        ) {
          // 风控、HTTP 拒绝、结构解析失败重试无意义，直接抛出。
          throw error;
        }
        // network 等暂时性错误：记录后重试。
        lastError = error;
        continue;
      }

      const items = body.data?.items ?? [];
      if (items.length === 0) {
        lastEmpty = body;
        continue;
      }
      return parseDynamicFeed(items, uid).slice(0, Math.max(0, limit));
    }

    if (lastEmpty) {
      // 多次重试后仍为空：确实没有动态。
      return [];
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new BilibiliDynamicError("动态请求失败且无有效响应", "network");
  }

  /** 单次请求：取 key → 签名 → 请求 → 校验业务码 → 吞吐 Cookie。 */
  private async requestFeed(uid: number): Promise<RawDynamicFeedResponse> {
    const keys = await this.session.getKeys();
    const signed = signWbiParams(
      { host_mid: String(uid), platform: "web", features: "itemOpusStyle" },
      keys,
      Math.floor(this.now() / 1000),
    );
    const url = `${this.apiBaseUrl}${DYNAMIC_FEED_PATH}?${signed.query}`;
    const result = await fetchJson(url, {
      fetch: this.fetchImpl,
      headers: this.session.headers(),
      timeoutMs: this.timeoutMs,
    });
    this.session.absorb(result.setCookies);

    if (result.status < 200 || result.status >= 300) {
      const kind = result.status === 412 ? "risk-control" : "http";
      throw new BilibiliDynamicError(
        `动态接口请求失败：HTTP ${result.status}`,
        kind,
        result.status,
      );
    }
    if (!result.json || typeof result.json !== "object") {
      throw new BilibiliDynamicError("动态接口返回非 JSON 内容", "parse");
    }

    const body = result.json as RawDynamicFeedResponse;
    const code = typeof body.code === "number" ? body.code : 0;
    if (code === SIGNATURE_EXPIRED_CODE) {
      throw new BilibiliDynamicError("动态接口签名失效（-352）", "signature", code);
    }
    if (RISK_CONTROL_CODES.has(code)) {
      throw new BilibiliDynamicError(
        `动态接口触发风控（${code}）：${body.message ?? body.msg ?? ""}`,
        "risk-control",
        code,
      );
    }
    if (code !== 0) {
      throw new BilibiliDynamicError(
        `动态接口返回错误（${code}）：${body.message ?? body.msg ?? ""}`,
        "business",
        code,
      );
    }
    return body;
  }
}

/** 便捷方法：用默认配置拉取一次动态。 */
export async function fetchUserDynamics(
  uid: number,
  options: DynamicFeedOptions = {},
  limit = 20,
): Promise<BilibiliDynamic[]> {
  return new BilibiliDynamicClient(options).fetchUserDynamics(uid, limit);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
