import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createError,
  deleteCookie,
  getCookie,
  getHeader,
  getRequestProtocol,
  setCookie,
  setHeader,
  type H3Event,
} from "h3";
import { readProjectAuthToken } from "@nana/utils";

const SESSION_COOKIE = "nana_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export function readSiteConfigToken(rootDir?: string): string | undefined {
  const token = readProjectAuthToken(rootDir);
  return token && token.length >= 16 ? token : undefined;
}

export function tokensEqual(expected: string, provided: string): boolean {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(expected), hash(provided));
}

function signature(payload: string, token: string): string {
  return createHmac("sha256", token).update(`nana-site-session:${payload}`).digest("base64url");
}

/** Cookie 只含签名会话，不保存原始管理口令；更换口令后旧会话立即失效。 */
export function hasSiteSession(event: H3Event, rootDir?: string): boolean {
  const token = readSiteConfigToken(rootDir);
  const cookie = getCookie(event, SESSION_COOKIE);
  if (!token || !cookie) return false;
  const [expires, nonce, signed, extra] = cookie.split(".");
  const seconds = Number(expires);
  if (!nonce || !signed || extra || !Number.isSafeInteger(seconds)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (seconds <= now || seconds > now + SESSION_MAX_AGE) return false;
  return tokensEqual(signature(`${expires}.${nonce}`, token), signed);
}

export function createSiteSession(event: H3Event, token: string): void {
  const payload = `${Math.floor(Date.now() / 1000) + SESSION_MAX_AGE}.${randomBytes(24).toString("base64url")}`;
  setCookie(event, SESSION_COOKIE, `${payload}.${signature(payload, token)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: getRequestProtocol(event, { xForwardedProto: true }) === "https",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSiteSession(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, { path: "/" });
}

export function requireSiteConfigToken(event: H3Event, rootDir?: string): void {
  setHeader(event, "Cache-Control", "no-store");
  const expected = readSiteConfigToken(rootDir);
  if (!expected)
    throw createError({
      statusCode: 503,
      statusMessage: "请先在根目录 .env 设置至少 16 位的 NANA_AUTH_TOKEN",
    });
  if (hasSiteSession(event, rootDir)) return;
  const authorization = getHeader(event, "authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!provided || !tokensEqual(expected, provided)) {
    throw createError({ statusCode: 401, statusMessage: "请登录后访问" });
  }
}
