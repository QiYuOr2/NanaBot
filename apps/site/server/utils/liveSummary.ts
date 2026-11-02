import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_KEYS } from "@nana/constants";
import { settleLiveSummary, type SettleLiveSummaryResult } from "@nana/live-summary";
import { resolveProjectRoot } from "@nana/utils";

/**
 * 读取 DeepSeek 密钥。
 *
 * 站点进程通常不加载机器人的 `.env`，所以环境变量为空时再读项目根的 `apps/bot/.env`。
 */
export function readDeepSeekApiKey(rootDir?: string): string | undefined {
  const fromEnv = process.env[ENV_KEYS.DEEPSEEK_API_KEY]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  let projectRoot: string;
  try {
    projectRoot = resolveProjectRoot(rootDir);
  } catch {
    return undefined;
  }

  try {
    return readEnvAssignment(readFileSync(join(projectRoot, "apps", "bot", ".env"), "utf8"));
  } catch {
    return undefined;
  }
}

/** 页面主动生成摘要。来源固定为 `site`，不会发到通知群。 */
export function requestSiteLiveSummary(sessionId: number): Promise<SettleLiveSummaryResult> {
  return settleLiveSummary({
    sessionId,
    source: "site",
    apiKey: readDeepSeekApiKey(),
  });
}

function readEnvAssignment(file: string): string | undefined {
  for (const line of file.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      continue;
    }
    if (trimmed.slice(0, separator).trim() !== ENV_KEYS.DEEPSEEK_API_KEY) {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim() || undefined;
  }
  return undefined;
}
