import { BilibiliDynamicError } from "./errors.ts";

/** 一次 HTTP 请求的结果：状态码、解析后的 JSON、以及响应返回的 Set-Cookie 键值对。 */
export interface HttpJsonResult {
  status: number;
  /** JSON 解析结果；非 JSON 或空响应时为 undefined。 */
  json: unknown;
  /** `Set-Cookie` 中 `name=value` 的部分（已去除属性）。 */
  setCookies: string[];
}

export interface HttpRequestOptions {
  fetch: typeof globalThis.fetch;
  headers: Record<string, string>;
  timeoutMs: number;
}

/**
 * 发起一次 GET 请求并解析 JSON。
 *
 * - 传输层错误（fetch 抛错、超时、abort）统一包装为 `network` 类错误。
 * - 从 `Set-Cookie` 头提取 `name=value`（保留分号前部分）。
 * - 不检查 HTTP 状态业务含义，交由调用方按 status/code 分流。
 */
export async function fetchJson(url: string, options: HttpRequestOptions): Promise<HttpJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
    });
  } catch (error) {
    throw new BilibiliDynamicError(
      `请求 B 站接口失败：${error instanceof Error ? error.message : String(error)}`,
      "network",
    );
  } finally {
    clearTimeout(timer);
  }

  const setCookies = readSetCookies(response.headers);
  const text = await response.text();
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { status: response.status, json, setCookies };
}

/** 读取响应中的 Set-Cookie，仅保留 `name=value`。 */
function readSetCookies(headers: Headers): string[] {
  // getSetCookie 在部分运行时不支持，做兼容。
  const getSetCookie = (headers as { getSetCookie?: () => string[] }).getSetCookie;
  const raw = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
  const result: string[] = [];
  for (const entry of raw) {
    const semicolon = entry.indexOf(";");
    const pair = semicolon >= 0 ? entry.slice(0, semicolon) : entry;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    result.push(pair.trim());
  }
  return result;
}
