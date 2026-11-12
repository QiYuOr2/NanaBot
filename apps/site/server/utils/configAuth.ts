import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { createError, getHeader, setHeader, type H3Event } from "h3";
import { ENV_KEYS } from "@nana/constants";
import { resolveProjectRoot } from "@nana/utils";

/** 独立管理口令，不读取机器人 AppSecret，也不通过接口返回凭据。 */
export function readSiteConfigToken(rootDir?: string): string | undefined {
  let value = process.env[ENV_KEYS.NANA_SITE_CONFIG_TOKEN];
  if (!value) {
    try {
      value = parseEnv(
        readFileSync(join(resolveProjectRoot(rootDir), "apps", "site", ".env"), "utf8"),
      )[ENV_KEYS.NANA_SITE_CONFIG_TOKEN];
    } catch {
      return undefined;
    }
  }
  const token = value?.trim();
  return token && token.length >= 16 ? token : undefined;
}

export function requireSiteConfigToken(event: H3Event, rootDir?: string): void {
  setHeader(event, "Cache-Control", "no-store");
  const expected = readSiteConfigToken(rootDir);
  if (!expected)
    throw createError({ statusCode: 503, statusMessage: "请先设置至少 16 位的配置管理口令" });
  const authorization = getHeader(event, "authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!provided || !timingSafeEqual(hash(expected), hash(provided))) {
    throw createError({ statusCode: 401, statusMessage: "配置管理口令不正确" });
  }
}
