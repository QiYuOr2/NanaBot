import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, createRouter, defineEventHandler, toNodeListener } from "h3";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { BOT_CONTROL_STATUS_PATH } from "@nana/constants";
import { writeLiveStatus } from "@nana/storage";
import auth from "../server/middleware/auth.ts";
import health from "../server/api/health.get.ts";
import status from "../server/api/status.get.ts";
import { readPublicStatus } from "../server/utils/publicStatus.ts";

const MANAGEMENT_TOKEN = "project-management-token-123456";
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function startStubBot(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No stub bot address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function withSite(
  botControlUrl: string,
  run: (base: string, rootDir: string) => Promise<void>,
) {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-site-status-"));
  roots.push(rootDir);
  const cwd = process.cwd();
  writeFileSync(join(rootDir, "nana.config.yaml"), "up: []\n");
  writeFileSync(join(rootDir, ".env"), `NANA_AUTH_TOKEN=${MANAGEMENT_TOKEN}\n`);
  writeLiveStatus(
    1001,
    { streamer: "私密主播名", live: true, updatedAt: "2026-01-01T00:00:00.000Z" },
    { rootDir },
  );
  process.chdir(rootDir);
  vi.stubEnv("NANA_AUTH_TOKEN", "");
  vi.stubEnv("NANA_SITE_CONFIG_TOKEN", "");
  vi.stubEnv("NANA_BOT_CONTROL_URL", botControlUrl);

  const router = createRouter()
    .get("/api/health", health)
    .get("/api/status", status)
    .get(
      "/api/monitor",
      defineEventHandler(() => ({ private: true })),
    );
  const server = createServer(toNodeListener(createApp().use(auth).use(router)));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No site server address");
    await run(`http://127.0.0.1:${address.port}`, rootDir);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(cwd);
  }
}

test("GET /api/status 公开免鉴权、禁止缓存、严格脱敏，全健康时返回 200", async () => {
  const bot = await startStubBot((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === BOT_CONTROL_STATUS_PATH) {
      response.end(
        JSON.stringify({
          ok: true,
          uptimeSeconds: 120,
          channels: { status: "ok", total: 2, connected: 2 },
          secretLeakAttempt: "account-123456-group-999999",
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false }));
  });

  try {
    await withSite(bot.url, async (base) => {
      // 私有接口仍受全站口令保护
      expect((await fetch(`${base}/api/monitor`)).status).toBe(401);
      // 既有廉价健康检查保持不变
      expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });

      const response = await fetch(`${base}/api/status`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const raw = await response.text();
      expect(raw).not.toContain("secretLeakAttempt");
      expect(raw).not.toContain("account-123456");
      expect(raw).not.toContain("私密主播名");
      expect(raw).not.toContain(MANAGEMENT_TOKEN);

      const body = JSON.parse(raw) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["checks", "status", "uptimeSeconds"]);
      expect(body).toEqual({
        status: "ok",
        uptimeSeconds: expect.any(Number),
        checks: {
          bot: "ok",
          channels: "ok",
          storage: "ok",
        },
      });
    });
  } finally {
    await bot.close();
  }
});

test("通道部分离线或全离线时 GET /api/status 返回 503 与 degraded 状态", async () => {
  let channelStatus: "degraded" | "error" = "degraded";
  const bot = await startStubBot((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === BOT_CONTROL_STATUS_PATH) {
      response.end(
        JSON.stringify({
          ok: true,
          uptimeSeconds: 60,
          channels: {
            status: channelStatus,
            total: 2,
            connected: channelStatus === "degraded" ? 1 : 0,
          },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    await withSite(bot.url, async (base) => {
      const degradedResp = await fetch(`${base}/api/status`);
      expect(degradedResp.status).toBe(503);
      expect(await degradedResp.json()).toEqual({
        status: "degraded",
        uptimeSeconds: expect.any(Number),
        checks: {
          bot: "ok",
          channels: "degraded",
          storage: "ok",
        },
      });

      channelStatus = "error";
      const errorResp = await fetch(`${base}/api/status`);
      expect(errorResp.status).toBe(503);
      expect(await errorResp.json()).toEqual({
        status: "degraded",
        uptimeSeconds: expect.any(Number),
        checks: {
          bot: "ok",
          channels: "error",
          storage: "ok",
        },
      });
    });
  } finally {
    await bot.close();
  }
});

test("bot 控制接口不可达或超时时返回 503 且 bot/channels 均标记为 error", async () => {
  const slowBot = await startStubBot((_request, _response) => {
    // 故意挂起不响应，触发探活超时。
  });
  const rootDir = mkdtempSync(join(tmpdir(), "nana-site-timeout-"));
  roots.push(rootDir);
  writeFileSync(join(rootDir, "nana.config.yaml"), "up: []\n");

  try {
    const started = Date.now();
    const timeoutResult = await readPublicStatus({
      rootDir,
      controlUrl: slowBot.url,
      timeoutMs: 120,
      uptimeSeconds: () => 86_400.9,
    });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(timeoutResult).toEqual({
      statusCode: 503,
      body: {
        status: "degraded",
        uptimeSeconds: 86_400,
        checks: {
          bot: "error",
          channels: "error",
          storage: "ok",
        },
      },
    });
  } finally {
    await slowBot.close();
  }

  // 关闭后的端口不可达
  const unreachableResult = await readPublicStatus({
    rootDir,
    controlUrl: slowBot.url,
    timeoutMs: 500,
    uptimeSeconds: () => 42,
  });
  expect(unreachableResult).toEqual({
    statusCode: 503,
    body: {
      status: "degraded",
      uptimeSeconds: 42,
      checks: {
        bot: "error",
        channels: "error",
        storage: "ok",
      },
    },
  });
});

test("SQLite 存储异常时返回 503 且 storage 标记为 error", async () => {
  const bot = await startStubBot((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === BOT_CONTROL_STATUS_PATH) {
      response.end(
        JSON.stringify({
          ok: true,
          uptimeSeconds: 30,
          channels: { status: "ok", total: 1, connected: 1 },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    await withSite(bot.url, async (base, rootDir) => {
      mkdirSync(join(rootDir, "db"), { recursive: true });
      writeFileSync(join(rootDir, "db", "live-status.sqlite"), "not a valid sqlite file");

      const response = await fetch(`${base}/api/status`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: "degraded",
        uptimeSeconds: expect.any(Number),
        checks: {
          bot: "ok",
          channels: "ok",
          storage: "error",
        },
      });
    });
  } finally {
    await bot.close();
  }
});
