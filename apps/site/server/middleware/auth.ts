import { createError, defineEventHandler, getHeader, getRequestURL, setHeader } from "h3";
import { posix } from "node:path";
import { requireSiteConfigToken } from "../utils/configAuth.ts";

const PUBLIC_API = new Set([
  "/api/auth/session",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
]);

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  // Nitro 会解码路由；鉴权必须使用同样或更严格的规范路径，避免 /%61pi/... 绕过。
  let decoded = url.pathname;
  try {
    for (let index = 0; index < 8; index++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (decoded.includes("%")) throw new Error("过度编码");
  } catch {
    throw createError({ statusCode: 400, statusMessage: "请求路径无效" });
  }
  const path = posix.normalize(decoded.replaceAll("\\", "/")).replace(/\/+$/, "").toLowerCase();
  if (!path.startsWith("/api/")) return;
  setHeader(event, "Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(event.method)) {
    const origin = getHeader(event, "origin");
    if (
      getHeader(event, "sec-fetch-site") === "cross-site" ||
      (origin &&
        origin !== getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin)
    ) {
      throw createError({ statusCode: 403, statusMessage: "不允许跨站请求" });
    }
  }
  // 桥接接口不走全站登录：status 只回数字（公开），其余由 handler 用桥接专用口令把关。
  if (path === "/api/bridge" || path.startsWith("/api/bridge/")) return;
  if (!PUBLIC_API.has(path)) requireSiteConfigToken(event);
});
