import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, createRouter, toNodeListener } from "h3";
import { afterEach, expect, test, vi } from "vite-plus/test";
import auth from "../server/middleware/auth.ts";
import status from "../server/api/bridge/status.get.ts";
import messages from "../server/api/bridge/messages.get.ts";
import send from "../server/api/bridge/send.post.ts";
import bind from "../server/api/bridge/bind.post.ts";
import typing from "../server/api/bridge/typing.post.ts";

const MANAGEMENT_TOKEN = "project-management-token-123456";
const BRIDGE_TOKEN = "bridge-only-token-123456";
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 起一个假 bot 控制接口：记录收到的口令，并按路径返回固定桥接结果。 */
async function stubBotControl() {
  const seenAuth: (string | undefined)[] = [];
  const seenStatusUrls: string[] = [];
  const server = createServer((request, response) => {
    seenAuth.push(request.headers.authorization);
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/bridge/status")) {
      seenStatusUrls.push(request.url);
      // bot 侧多给一个字段，验证 site 只透出约定的两个数字。
      response.end(JSON.stringify({ ok: true, bound: true, latestInboundSeq: 7, extra: "x" }));
      return;
    }
    if (request.url?.startsWith("/bridge/messages")) {
      response.end(JSON.stringify({ ok: true, bound: true, ownerId: "OPENID_A", messages: [] }));
      return;
    }
    if (request.url?.startsWith("/bridge/send")) {
      response.end(JSON.stringify({ ok: true, via: "reply" }));
      return;
    }
    if (request.url?.startsWith("/bridge/typing")) {
      response.end(JSON.stringify({ ok: true, typing: true, seconds: 10 }));
      return;
    }
    if (request.url?.startsWith("/bridge/bind")) {
      response.end(JSON.stringify({ ok: true, bound: true, ownerId: "OPENID_A" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No stub address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    seenAuth,
    seenStatusUrls,
    close: () => server.close(),
  };
}

async function withSite(
  run: (base: string, bot: Awaited<ReturnType<typeof stubBotControl>>) => Promise<void>,
) {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-site-bridge-"));
  roots.push(rootDir);
  const cwd = process.cwd();
  writeFileSync(join(rootDir, "nana.config.yaml"), "up: []\n");
  const bot = await stubBotControl();
  process.chdir(rootDir);
  // 桥接口令经进程环境注入（读取顺序：进程环境 > 根目录 .env > apps/site/.env）。
  vi.stubEnv("NANA_BRIDGE_TOKEN", BRIDGE_TOKEN);
  vi.stubEnv("NANA_BOT_CONTROL_URL", bot.url);
  const router = createRouter()
    .get("/api/bridge/status", status)
    .get("/api/bridge/messages", messages)
    .post("/api/bridge/send", send)
    .post("/api/bridge/bind", bind)
    .post("/api/bridge/typing", typing);
  const server = createServer(toNodeListener(createApp().use(auth).use(router)));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");
    await run(`http://127.0.0.1:${address.port}`, bot);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    bot.close();
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
}

test("bridge 中转：status 公开且只回数字，messages/send/bind 只认桥接专用口令", async () => {
  await withSite(async (base, bot) => {
    const statusResponse = await fetch(`${base}/api/bridge/status?account=777001`);
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual({
      bound: true,
      latestInboundSeq: 7,
      latestGroupInboundSeq: 0,
      latestGroupId: null,
    });

    const noKey = await fetch(`${base}/api/bridge/messages?account=777001`);
    expect(noKey.status).toBe(401);

    // 全站管理口令不能替代桥接口令。
    const management = await fetch(`${base}/api/bridge/messages?account=777001`, {
      headers: { Authorization: `Bearer ${MANAGEMENT_TOKEN}` },
    });
    expect(management.status).toBe(401);

    const withKey = await fetch(`${base}/api/bridge/messages?account=777001&after=0`, {
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
    });
    expect(withKey.status).toBe(200);
    await expect(withKey.json()).resolves.toMatchObject({ ok: true, bound: true });

    const sendResponse = await fetch(`${base}/api/bridge/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001", text: "你好" }),
    });
    expect(sendResponse.status).toBe(200);
    await expect(sendResponse.json()).resolves.toMatchObject({ ok: true, via: "reply" });

    const bindDenied = await fetch(`${base}/api/bridge/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001", senderId: "OPENID_A" }),
    });
    expect(bindDenied.status).toBe(401);

    // site 转发给 bot 时用的也是桥接口令（服务端到服务端）。
    expect(bot.seenAuth).toContain(`Bearer ${BRIDGE_TOKEN}`);
    expect(bot.seenAuth).not.toContain(`Bearer ${MANAGEMENT_TOKEN}`);
  });
});

test("bridge 中转：status 透传 since/wait 长轮询参数，非法参数拒绝", async () => {
  await withSite(async (base, bot) => {
    const res = await fetch(`${base}/api/bridge/status?account=777001&since=3&wait=5`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      bound: true,
      latestInboundSeq: 7,
      latestGroupInboundSeq: 0,
      latestGroupId: null,
    });
    expect(bot.seenStatusUrls.at(-1)).toContain("since=3");
    expect(bot.seenStatusUrls.at(-1)).toContain("wait=5");

    const bad = await fetch(`${base}/api/bridge/status?account=777001&wait=99`);
    expect(bad.status).toBe(400);
  });
});

test("bridge 中转：send 支持 markdown / image，typing 只认桥接专用口令", async () => {
  await withSite(async (base) => {
    const markdown = await fetch(`${base}/api/bridge/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001", markdown: "# 你好" }),
    });
    expect(markdown.status).toBe(200);

    const image = await fetch(`${base}/api/bridge/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "777001",
        text: "看图",
        image: "https://example.com/a.png",
      }),
    });
    expect(image.status).toBe(200);

    // markdown 与 image 互斥。
    const conflict = await fetch(`${base}/api/bridge/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "777001",
        markdown: "# x",
        image: "https://example.com/a.png",
      }),
    });
    expect(conflict.status).toBe(400);

    const typingNoKey = await fetch(`${base}/api/bridge/typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001" }),
    });
    expect(typingNoKey.status).toBe(401);

    const typingOk = await fetch(`${base}/api/bridge/typing`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001", seconds: 20 }),
    });
    expect(typingOk.status).toBe(200);
    await expect(typingOk.json()).resolves.toMatchObject({ ok: true, typing: true });
  });
});

test("bridge 中转：send 支持 voice 独立发送，与 text 同时提供时拒绝", async () => {
  await withSite(async (base) => {
    const voice = await fetch(`${base}/api/bridge/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001", voice: "base64://AAAA" }),
    });
    expect(voice.status).toBe(200);

    const conflict = await fetch(`${base}/api/bridge/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001", voice: "base64://AAAA", text: "听这个" }),
    });
    expect(conflict.status).toBe(400);
  });
});

test("bridge 中转：send 支持 groupId 透传，messages 支持 group 读取", async () => {
  await withSite(async (base) => {
    const groupSend = await fetch(`${base}/api/bridge/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "777001", groupId: "GROUP_1", text: "大家好" }),
    });
    expect(groupSend.status).toBe(200);

    const groupMessages = await fetch(
      `${base}/api/bridge/messages?account=777001&after=0&group=GROUP_1`,
      { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } },
    );
    expect(groupMessages.status).toBe(200);
  });
});
