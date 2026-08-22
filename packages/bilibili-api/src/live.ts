import { BilibiliApiError } from "./errors.ts";
import { BILIBILI_API_BASE_URL, BILIBILI_LIVE_ENDPOINTS } from "./endpoints.ts";
import type { BilibiliApiOptions, LiveStatusByUidResponse, LiveStatusInfo } from "./types.ts";

export async function getLiveStatusByUids(
  uids: readonly number[],
  options: BilibiliApiOptions = {},
): Promise<Record<string, LiveStatusInfo>> {
  const baseUrl = options.baseUrl ?? BILIBILI_API_BASE_URL;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("当前运行环境不支持 fetch，请传入 BilibiliApiOptions.fetch。");
  }

  if (uids.length === 0) {
    throw new TypeError("uids 不能为空。");
  }

  const url = new URL(BILIBILI_LIVE_ENDPOINTS.getStatusInfoByUids, baseUrl);
  for (const uid of uids) {
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new TypeError(`uid 必须是正整数：${uid}`);
    }
    url.searchParams.append("uids[]", String(uid));
  }

  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) {
    throw new BilibiliApiError(`B 站接口请求失败：HTTP ${response.status}`);
  }

  const result = (await response.json()) as LiveStatusByUidResponse;
  if (result.code !== 0) {
    throw new BilibiliApiError(result.message || result.msg || "B 站接口返回错误", result.code);
  }

  return result.data;
}
