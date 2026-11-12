import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, createRouter, defineEventHandler, toNodeListener } from "h3";
import { expect, test, vi } from "vite-plus/test";
import auth from "../server/middleware/auth.ts";
import login from "../server/api/auth/login.post.ts";
import logout from "../server/api/auth/logout.post.ts";
import session from "../server/api/auth/session.get.ts";
import logs from "../server/api/logs.get.ts";
import health from "../server/api/health.get.ts";
import { SESSION_MAX_AGE } from "../server/utils/configAuth.ts";

const token = "project-management-token-123456";
async function withSite(run: (base: string) => Promise<void>) {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-site-auth-"));
  const cwd = process.cwd();
  writeFileSync(join(rootDir, "nana.config.yaml"), "up: []\n");
  writeFileSync(join(rootDir, ".env"), `NANA_AUTH_TOKEN=${token}\n`);
  mkdirSync(join(rootDir, "logs"));
  writeFileSync(join(rootDir, "logs/bot.log"), "private log\n");
  process.chdir(rootDir);
  vi.stubEnv("NANA_AUTH_TOKEN", "");
  vi.stubEnv("NANA_SITE_CONFIG_TOKEN", "");
  const router = createRouter()
    .post("/api/auth/login", login)
    .post("/api/auth/logout", logout)
    .get("/api/auth/session", session)
    .get("/api/health", health)
    .get("/api/logs", logs)
    .get(
      "/api/live-status",
      defineEventHandler(() => ({ private: true })),
    );
  const server = createServer(toNodeListener(createApp().use(auth).use(router)));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(rootDir, { force: true, recursive: true });
  }
}

async function signIn(base: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ token }),
  });
}

test("全站 API 受保护，登录后通过持久会话读取日志，公开健康检查不泄漏数据", async () => {
  await withSite(async (base) => {
    expect(await (await fetch(`${base}/api/auth/session`)).json()).toEqual({
      configured: true,
      authenticated: false,
    });
    for (const path of [
      "/api/live-status",
      "/api/logs",
      "/api/settings/status",
      "/%61pi/logs",
      "/%2561pi/logs",
      "/API/logs",
      "//api/logs",
    ]) {
      expect((await fetch(`${base}${path}`)).status).toBe(401);
    }
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
    const response = await signIn(base);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${SESSION_MAX_AGE}`);
    expect(setCookie).not.toContain(token);
    const cookie = setCookie.split(";")[0];
    expect(await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json()).toEqual(
      { configured: true, authenticated: true },
    );
    const logResponse = await fetch(`${base}/api/logs`, { headers: { cookie } });
    expect(logResponse.headers.get("cache-control")).toBe("no-store");
    expect((await logResponse.json()).content).toBe("private log");
    expect(
      (await fetch(`${base}/api/logs`, { headers: { cookie: `${cookie}corrupted` } })).status,
    ).toBe(401);
    const signedOut = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(`${base}/api/logs`)).status).toBe(401);
  });
});

test("会话到期或口令轮换后失效；HTTPS 会话带 Secure，跨站写请求被拒绝", async () => {
  await withSite(async (base) => {
    const response = await signIn(base, { "X-Forwarded-Proto": "https" });
    expect(response.headers.get("set-cookie")).toContain("Secure");
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    expect((await signIn(base, { Origin: "https://evil.example" })).status).toBe(403);
    expect(
      (
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { cookie, "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    vi.stubEnv("NANA_AUTH_TOKEN", "rotated-management-token-123456");
    expect((await fetch(`${base}/api/logs`, { headers: { cookie } })).status).toBe(401);
    vi.stubEnv("NANA_AUTH_TOKEN", "");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + (SESSION_MAX_AGE + 1) * 1000);
    expect((await fetch(`${base}/api/logs`, { headers: { cookie } })).status).toBe(401);
  });
});

test("错误口令不建立会话", async () => {
  await withSite(async (base) => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await signIn(base)).status).toBe(200);
  });
});
