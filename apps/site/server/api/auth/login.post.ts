import { createError, defineEventHandler, getRequestIP, readBody, setHeader } from "h3";
import { createSiteSession, readSiteConfigToken, tokensEqual } from "../../utils/configAuth.ts";

const attempts = new Map<string, { count: number; until: number }>();

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const expected = readSiteConfigToken();
  if (!expected)
    throw createError({
      statusCode: 503,
      statusMessage: "请先在根目录 .env 设置至少 16 位的 NANA_AUTH_TOKEN",
    });
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const ip = getRequestIP(event) ?? "unknown";
  const attempt = attempts.get(ip);
  if (attempt && attempt.count >= 10)
    throw createError({ statusCode: 429, statusMessage: "尝试次数过多，请一分钟后重试" });
  const body = await readBody<unknown>(event);
  const provided = body && typeof body === "object" && "token" in body ? body.token : undefined;
  if (typeof provided !== "string" || provided.length > 4096 || !tokensEqual(expected, provided)) {
    if (attempts.size >= 10_000 && !attempt) attempts.clear();
    attempts.set(ip, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now + 60_000 });
    throw createError({ statusCode: 401, statusMessage: "管理口令不正确" });
  }
  attempts.delete(ip);
  createSiteSession(event, expected);
  return { authenticated: true };
});
