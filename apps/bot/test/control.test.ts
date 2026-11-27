import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  BOT_CONTROL_HEALTH_PATH,
  BOT_CONTROL_STATUS_PATH,
  BOT_CONTROL_TEST_MESSAGE_PATH,
} from "@nana/constants";
import { readPushLogs } from "@nana/storage";
import type { QQClientPort, QQMessagePart } from "@nana/qq";
import { parseQQConfig, resolveOfficialAccounts } from "../src/qq/config.ts";
import { createOfficialApp } from "../src/qq/app.ts";
import { startBotControlServer, type TestMessageRuntime } from "../src/control/index.ts";
import type { QQRuntimeAccount } from "../src/accounts/resolve.ts";
import type { Logger } from "../src/core/logger.ts";

const TOKEN = "control-test-token-123456";
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness() {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-control-"));
  roots.push(rootDir);
  writeFileSync(
    join(rootDir, "nana.config.yaml"),
    JSON.stringify({
      accounts: [
        {
          id: "official",
          provider: "official",
          official: {},
          groups: { 123: { openid: "GROUP_OPENID", name: "测试群" } },
        },
      ],
    }),
  );
  const [account] = resolveOfficialAccounts(
    parseQQConfig({
      accounts: [
        {
          id: "official",
          provider: "official",
          official: {},
          groups: { 123: { openid: "GROUP_OPENID", name: "测试群" } },
        },
      ],
    }).accounts,
    { QQ_BOT_APP_ID: "app", QQ_BOT_APP_SECRET: "super-secret" },
  );
  const sent: { openid: string; parts: readonly QQMessagePart[] }[] = [];
  const client: QQClientPort = {
    on: () => () => {},
    start: async () => {},
    stop: () => {},
    async sendGroupMessage(openid, parts) {
      sent.push({ openid, parts });
      return { id: "message-1" };
    },
    async sendPrivateMessage(openid, parts) {
      sent.push({ openid, parts });
      return { id: "private-message-1" };
    },
    async replyMessage() {
      return { id: "reply-1" };
    },
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = createOfficialApp({ account, client, storage: { rootDir }, logger });
  return { rootDir, account, app, sent, logger };
}

async function withControl(
  runtimes: ReadonlyMap<string, TestMessageRuntime>,
  rootDir: string,
  logger: Logger,
  run: (url: string) => Promise<void>,
) {
  vi.stubEnv("NANA_SITE_CONFIG_TOKEN", TOKEN);
  const server = await startBotControlServer({ runtimes, rootDir, logger, port: 0 });
  try {
    await run(server.url);
  } finally {
    await server.stop();
  }
}

test("bot 控制接口与 site 共用根目录项目口令，优先于旧应用口令", async () => {
  const { rootDir, account, app, sent, logger } = harness();
  const projectToken = `${TOKEN}-project`;
  writeFileSync(join(rootDir, ".env"), `NANA_AUTH_TOKEN=${projectToken}\n`);
  vi.stubEnv("NANA_AUTH_TOKEN", "");
  await withControl(new Map([["official", { account, app }]]), rootDir, logger, async (url) => {
    const request = (token: string) =>
      fetch(`${url}${BOT_CONTROL_TEST_MESSAGE_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: "official",
          groupId: "123",
          expectedOpenid: "GROUP_OPENID",
          kind: "text",
        }),
      });
    expect((await request(TOKEN)).status).toBe(401);
    expect((await request(projectToken)).status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

test("测试消息走运行中的 bot 账号，普通消息与 @全体都写入 message.test", async () => {
  const { rootDir, account, app, sent, logger } = harness();
  const runtimes = new Map([["official", { account, app }]]);
  await withControl(runtimes, rootDir, logger, async (url) => {
    const text = await fetch(`${url}${BOT_CONTROL_TEST_MESSAGE_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "official",
        groupId: "123",
        expectedOpenid: "GROUP_OPENID",
        kind: "text",
      }),
    });
    expect(text.status).toBe(200);
    expect(await text.json()).toEqual({ ok: true, target: "测试群" });
    expect(sent).toEqual([
      {
        openid: "GROUP_OPENID",
        parts: [{ type: "text", text: "NanaBot 普通测试消息：群消息发送测试。" }],
      },
    ]);

    const atAll = await fetch(`${url}${BOT_CONTROL_TEST_MESSAGE_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "official",
        groupId: "123",
        expectedOpenid: "GROUP_OPENID",
        kind: "atAll",
      }),
    });
    expect(atAll.status).toBe(200);
    expect(sent.at(-1)?.parts).toEqual([
      { type: "atAll" },
      { type: "text", text: "NanaBot @全体测试消息：群提醒测试。" },
    ]);
  });
  expect(readPushLogs({ rootDir })).toEqual([
    expect.objectContaining({ purpose: "message.test", success: true, account: "official" }),
    expect.objectContaining({ purpose: "message.test", success: true, account: "official" }),
  ]);
});

test("鉴权失败、账号未运行、群映射变化与非法字段都在 bot 侧拒绝", async () => {
  const { rootDir, account, app, sent, logger } = harness();
  const runtimes = new Map([["official", { account, app }]]);
  await withControl(runtimes, rootDir, logger, async (url) => {
    const request = (authorization: string, body: unknown) =>
      fetch(`${url}${BOT_CONTROL_TEST_MESSAGE_PATH}`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const valid = {
      accountId: "official",
      groupId: "123",
      expectedOpenid: "GROUP_OPENID",
      kind: "text",
    };

    expect((await request("Bearer wrong-token", valid)).status).toBe(401);
    expect(
      (
        await request(`Bearer ${TOKEN}`, {
          ...valid,
          accountId: "missing",
        })
      ).status,
    ).toBe(503);
    expect((await request(`Bearer ${TOKEN}`, { ...valid, expectedOpenid: "OLD" })).status).toBe(
      409,
    );
    expect((await request(`Bearer ${TOKEN}`, { ...valid, openid: "INJECTED" })).status).toBe(400);
    expect((await request(`Bearer ${TOKEN}`, { ...valid, groupId: "999" })).status).toBe(400);
  });
  expect(sent).toEqual([]);
  expect(readPushLogs({ rootDir })).toEqual([]);
});

test("NapCat 账号按同一控制接口走自己的发送实现", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-control-nc-"));
  roots.push(rootDir);
  const account: QQRuntimeAccount = {
    id: "nc",
    name: "NapCat 号",
    provider: "napcat",
    wsUrl: "ws://127.0.0.1:1111",
    accessToken: "nc-token",
  };
  const sendGroupMsg = vi.fn(async () => "测试群");
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const runtimes = new Map([["nc", { account, app: { sendGroupMsg } }]]);
  await withControl(runtimes, rootDir, logger, async (url) => {
    const response = await fetch(`${url}${BOT_CONTROL_TEST_MESSAGE_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "nc",
        groupId: "456",
        expectedOpenid: null,
        kind: "text",
      }),
    });
    expect(response.status).toBe(200);
    expect(sendGroupMsg).toHaveBeenCalledWith(
      456,
      expect.objectContaining({ purpose: "message.test" }),
      expect.any(Array),
    );
  });
});

test("发送失败返回 502，且响应与推送记录不泄露机器人密钥", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-control-fail-"));
  roots.push(rootDir);
  writeFileSync(
    join(rootDir, "nana.config.yaml"),
    JSON.stringify({
      accounts: [
        {
          id: "official",
          provider: "official",
          official: {},
          groups: { 123: { openid: "GROUP_OPENID" } },
        },
      ],
    }),
  );
  const [account] = resolveOfficialAccounts(
    parseQQConfig({
      accounts: [
        {
          id: "official",
          provider: "official",
          official: {},
          groups: { 123: { openid: "GROUP_OPENID" } },
        },
      ],
    }).accounts,
    { QQ_BOT_APP_ID: "app", QQ_BOT_APP_SECRET: "super-secret" },
  );
  const client: QQClientPort = {
    on: () => () => {},
    start: async () => {},
    stop: () => {},
    async sendGroupMessage() {
      throw new Error("invalid super-secret");
    },
    async sendPrivateMessage() {
      throw new Error("invalid super-secret");
    },
    async replyMessage() {
      throw new Error("invalid super-secret");
    },
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = createOfficialApp({ account, client, storage: { rootDir }, logger });
  const runtimes = new Map([["official", { account, app }]]);
  await withControl(runtimes, rootDir, logger, async (url) => {
    const response = await fetch(`${url}${BOT_CONTROL_TEST_MESSAGE_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "official",
        groupId: "123",
        expectedOpenid: "GROUP_OPENID",
        kind: "text",
      }),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("super-secret");
  });
  expect(readPushLogs({ rootDir })[0].error).not.toContain("super-secret");
});

test("健康检查不需要口令，只返回存活状态", async () => {
  const { rootDir, logger } = harness();
  await withControl(new Map(), rootDir, logger, async (url) => {
    const response = await fetch(`${url}${BOT_CONTROL_HEALTH_PATH}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

test("本机状态探针不需要口令，返回脱敏的通道在线汇总（ok / degraded / error）", async () => {
  const { rootDir, logger } = harness();
  let snapshot = {
    totalAccounts: 2,
    connectedAccounts: 2,
    startedAt: Date.now() - 12_000,
  };
  const server = await startBotControlServer({
    runtimes: new Map(),
    getStatus: () => snapshot,
    rootDir,
    logger,
    port: 0,
  });
  try {
    const okResp = await fetch(`${server.url}${BOT_CONTROL_STATUS_PATH}`);
    expect(okResp.status).toBe(200);
    expect(okResp.headers.get("cache-control")).toBe("no-store");
    const okBody = (await okResp.json()) as Record<string, unknown>;
    expect(Object.keys(okBody).sort()).toEqual(["channels", "ok", "uptimeSeconds"]);
    expect(okBody).toEqual({
      ok: true,
      uptimeSeconds: expect.any(Number),
      channels: { status: "ok", total: 2, connected: 2 },
    });

    snapshot = { totalAccounts: 2, connectedAccounts: 1, startedAt: snapshot.startedAt };
    const degradedBody = await (await fetch(`${server.url}${BOT_CONTROL_STATUS_PATH}`)).json();
    expect(degradedBody).toEqual({
      ok: true,
      uptimeSeconds: expect.any(Number),
      channels: { status: "degraded", total: 2, connected: 1 },
    });

    snapshot = { totalAccounts: 2, connectedAccounts: 0, startedAt: snapshot.startedAt };
    const errorBody = await (await fetch(`${server.url}${BOT_CONTROL_STATUS_PATH}`)).json();
    expect(errorBody).toEqual({
      ok: true,
      uptimeSeconds: expect.any(Number),
      channels: { status: "error", total: 2, connected: 0 },
    });

    snapshot = { totalAccounts: 0, connectedAccounts: 0, startedAt: snapshot.startedAt };
    const emptyBody = await (await fetch(`${server.url}${BOT_CONTROL_STATUS_PATH}`)).json();
    expect(emptyBody).toEqual({
      ok: true,
      uptimeSeconds: expect.any(Number),
      channels: { status: "error", total: 0, connected: 0 },
    });
  } finally {
    await server.stop();
  }
});

test("本机状态探针缺省 getStatus 时按 runtimes 实时连接态汇总且不泄露敏感字段", async () => {
  const { rootDir, account, logger } = harness();
  let connected = true;
  const runtimes = new Map<string, TestMessageRuntime>([
    [
      "official",
      {
        account,
        app: {
          sendGroupMsg: vi.fn(async () => "测试群"),
          get connected() {
            return connected;
          },
        },
      },
    ],
  ]);
  await withControl(runtimes, rootDir, logger, async (url) => {
    const first = await fetch(`${url}${BOT_CONTROL_STATUS_PATH}`);
    const firstText = await first.text();
    expect(firstText).not.toContain("official");
    expect(firstText).not.toContain("GROUP_OPENID");
    expect(firstText).not.toContain("super-secret");
    expect(JSON.parse(firstText)).toEqual({
      ok: true,
      uptimeSeconds: expect.any(Number),
      channels: { status: "ok", total: 1, connected: 1 },
    });

    connected = false;
    const second = await (await fetch(`${url}${BOT_CONTROL_STATUS_PATH}`)).json();
    expect(second).toEqual({
      ok: true,
      uptimeSeconds: expect.any(Number),
      channels: { status: "error", total: 1, connected: 0 },
    });
  });
});
