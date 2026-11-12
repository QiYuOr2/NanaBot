import { ENV_KEYS } from "@nana/constants";
import { settleLiveSummary, type SettleLiveSummaryResult } from "@nana/live-summary";
import { readAppEnvValue } from "@nana/utils";

/**
 * 读取 DeepSeek 密钥。
 *
 * 站点进程通常不加载机器人的 `.env`，所以环境变量为空时再读项目根的 `apps/bot/.env`。
 */
export function readDeepSeekApiKey(rootDir?: string): string | undefined {
  return readAppEnvValue("bot", ENV_KEYS.DEEPSEEK_API_KEY, rootDir);
}

/** 页面主动生成摘要。来源固定为 `site`，不会发到通知群。 */
export function requestSiteLiveSummary(sessionId: number): Promise<SettleLiveSummaryResult> {
  return settleLiveSummary({
    sessionId,
    source: "site",
    apiKey: readDeepSeekApiKey(),
  });
}
