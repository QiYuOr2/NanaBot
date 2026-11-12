import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp, createRouter, toNodeListener } from "h3";
import { expect, test, vi } from "vite-plus/test";
import { BOT_CONTROL_TEST_MESSAGE_PATH } from "@nana/constants";
import getSettings from "../server/api/settings/qq-groups.get.ts";
import putSettings from "../server/api/settings/qq-groups.put.ts";
import getStatus from "../server/api/settings/status.get.ts";
import postTestMessage from "../server/api/settings/qq-groups/test.post.ts";
import { recordDiscoveredQQGroup, readPushLogs } from "@nana/storage";

interface BotControlStub {
  requests: { authorization: string | undefined; body: unknown }[];
  status: number;
  response: unknown;
}

async function withSite(
  run: (base: string, rootDir: string, bot: BotControlStub) => Promise<void>,
  configured = true,
  configuration?: string,
  botStatus = 200,
  botResponse: unknown = { ok: true, target: "测试群" },
) {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-qq-site-"));
  const cwd = process.cwd();
  const bot: BotControlStub = { requests: [], status: botStatus, response: botResponse };
  const botServer = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== BOT_CONTROL_TEST_MESSAGE_PATH) {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bot.requests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
    });
    response.writeHead(bot.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(bot.response));
  });
  mkdirSync(join(rootDir, "apps", "site"), { recursive: true });
  writeFileSync(
    join(rootDir, "nana.config.yaml"),
    configuration ??
      `# 保留配置注释\naccounts:\n  - id: main\n    provider: official\n    official: {}\n    adminGroup: 123\n  - id: nc\n    provider: napcat\n    napcat:\n      wsUrl: ws://localhost:1111\n      accessToken: never-return-this\nup: []\n`,
  );
  vi.stubEnv("NANA_SITE_CONFIG_TOKEN", "");
  vi.stubEnv("NANA_BOT_CONTROL_URL", "");
  vi.stubEnv("QQ_BOT_APP_ID", "");
  vi.stubEnv("QQ_BOT_APP_SECRET", "");
  vi.stubEnv("APP_TWO", "");
  vi.stubEnv("SECRET_TWO", "");
  process.chdir(rootDir);
  await new Promise<void>((resolve) => botServer.listen(0, "127.0.0.1", resolve));
  const botAddress = botServer.address();
  if (!botAddress || typeof botAddress === "string") throw new Error("No bot control address");
  if (configured)
    writeFileSync(
      join(rootDir, "apps", "site", ".env"),
      `NANA_SITE_CONFIG_TOKEN=test-management-token-123456\nNANA_BOT_CONTROL_URL=http://127.0.0.1:${botAddress.port}\n`,
    );
  const router = createRouter()
    .get("/status", getStatus)
    .get("/groups", getSettings)
    .put("/groups", putSettings)
    .post("/test", postTestMessage);
  const server = createServer(toNodeListener(createApp().use(router)));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    await run(`http://127.0.0.1:${address.port}`, rootDir, bot);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    botServer.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      botServer.close((error) => (error ? reject(error) : resolve())),
    );
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(rootDir, { recursive: true, force: true });
  }
}
const headers = {
  Authorization: "Bearer test-management-token-123456",
  "Content-Type": "application/json",
};

test("未解锁时配置读写均被拒绝，公开状态不包含口令", async () => {
  await withSite(async (base, rootDir) => {
    const status = await (await fetch(`${base}/status`)).json();
    expect(status).toEqual({ configured: true });
    const before = readFileSync(join(rootDir, "nana.config.yaml"), "utf8");
    expect((await fetch(`${base}/groups`)).status).toBe(401);
    expect((await fetch(`${base}/groups`, { method: "PUT", body: "{}" })).status).toBe(401);
    expect((await fetch(`${base}/test`, { method: "POST", body: "{}" })).status).toBe(401);
    expect(readFileSync(join(rootDir, "nana.config.yaml"), "utf8")).toBe(before);
  });
});

test("顶层混合账号只为官方账号保存映射，未指定账号的主播不绑定群", async () => {
  const config = {
    accounts: [
      {
        id: "api",
        name: "官方号",
        provider: "official",
        official: { appIdEnv: "APP", appSecretEnv: "SECRET" },
      },
      {
        id: "nc",
        name: "NapCat号",
        provider: "napcat",
        napcat: { wsUrl: "ws://localhost:1111", accessToken: "DO_NOT_EXPOSE" },
      },
    ],
    up: [
      { uname: "默认主播", liveMonitorConfig: { notifyGroups: [123] } },
      { uname: "官方主播", qqAccount: "api", liveMonitorConfig: { notifyGroups: [456] } },
    ],
  };
  await withSite(
    async (base, rootDir) => {
      recordDiscoveredQQGroup(
        {
          accountId: "api",
          appId: "APP_ID",
          openid: "API_GROUP",
          lastSeenAt: new Date().toISOString(),
        },
        { rootDir },
      );
      const view = await (await fetch(`${base}/groups`, { headers })).json();
      expect(view.provider).toBe("mixed");
      expect(view.napcatAccounts).toEqual([{ id: "nc", name: "NapCat号" }]);
      expect(view.accounts.map((account: { id: string }) => account.id)).toEqual(["api"]);
      expect(view.accounts[0].groups.map((group: { id: string }) => group.id)).toEqual(["456"]);
      expect(view.accounts[0].discovered[0].openid).toBe("API_GROUP");
      expect(JSON.stringify(view)).not.toContain("DO_NOT_EXPOSE");
      const payload = {
        accountId: "api",
        groupId: "456",
        openid: "API_GROUP",
        name: "通知群",
        expectedOpenid: null,
      };
      expect(
        (await fetch(`${base}/groups`, { method: "PUT", headers, body: JSON.stringify(payload) }))
          .status,
      ).toBe(200);
      expect(
        (
          await fetch(`${base}/groups`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ ...payload, accountId: "nc", groupId: "123" }),
          })
        ).status,
      ).toBe(400);
      const content = readFileSync(join(rootDir, "nana.config.yaml"), "utf8");
      expect(content).toContain("DO_NOT_EXPOSE");
      expect(content).not.toContain("qq:");
    },
    true,
    JSON.stringify(config),
  );
});

test("认证后可补齐空映射，保留其它配置，拒绝过期覆盖与额外字段", async () => {
  await withSite(async (base, rootDir) => {
    const response = await fetch(`${base}/groups`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const view = await response.json();
    expect(view.accounts[0].groups[0]).toMatchObject({ id: "123", openid: null });
    expect(JSON.stringify(view)).not.toContain("never-return-this");
    const payload = {
      accountId: "main",
      groupId: "123",
      openid: "FOUND_GROUP",
      name: "管理群",
      expectedOpenid: null,
    };
    const save = () =>
      fetch(`${base}/groups`, { method: "PUT", headers, body: JSON.stringify(payload) });
    expect((await save()).status).toBe(200);
    const content = readFileSync(join(rootDir, "nana.config.yaml"), "utf8");
    expect(content).toContain("# 保留配置注释");
    expect(content).toContain("never-return-this");
    expect((await save()).status).toBe(409);
    expect(
      (
        await fetch(`${base}/groups`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ ...payload, appSecret: "forbidden" }),
        })
      ).status,
    ).toBe(400);
    expect(readFileSync(join(rootDir, "nana.config.yaml"), "utf8")).toBe(content);
  });
});

test("未设置管理口令时写入入口关闭", async () => {
  await withSite(async (base) => {
    expect(await (await fetch(`${base}/status`)).json()).toEqual({ configured: false });
    expect((await fetch(`${base}/groups`, { headers })).status).toBe(503);
  }, false);
});

const boundConfig = JSON.stringify({
  accounts: [
    { id: "main", provider: "official", official: {}, groups: { 123: { openid: "GROUP_MAIN" } } },
    {
      id: "second",
      provider: "official",
      official: { appIdEnv: "APP_TWO", appSecretEnv: "SECRET_TWO" },
      groups: { 456: { openid: "GROUP_SECOND", name: "第二个机器人的群" } },
    },
    {
      id: "nc",
      provider: "napcat",
      napcat: { wsUrl: "ws://localhost:1111", accessToken: "not-used" },
    },
  ],
  up: [],
});
const testPayload = {
  accountId: "second",
  groupId: "456",
  expectedOpenid: "GROUP_SECOND",
  kind: "text",
};

test.each(["text", "atAll"])(
  "测试 %s 转发给运行中的 bot，由 bot 使用当前账号发送",
  async (kind) => {
    await withSite(
      async (base, rootDir, bot) => {
        const response = await fetch(`${base}/test`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...testPayload, kind }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ sent: true, target: "测试群" });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(bot.requests).toEqual([
          {
            authorization: "Bearer test-management-token-123456",
            body: { ...testPayload, kind },
          },
        ]);
        expect(readPushLogs({ rootDir })).toEqual([]);
      },
      true,
      boundConfig,
    );
  },
);

test("未保存的群、NapCat、未知账号、过期映射与任意目标注入都不会发送", async () => {
  await withSite(
    async (base, rootDir, bot) => {
      for (const [payload, status] of [
        [{ ...testPayload, groupId: "789" }, 400],
        [{ ...testPayload, accountId: "nc" }, 400],
        [{ ...testPayload, accountId: "missing" }, 400],
        [{ ...testPayload, expectedOpenid: "OLD_GROUP" }, 409],
        [{ ...testPayload, openid: "INJECTED_GROUP" }, 400],
        [{ ...testPayload, kind: "image" }, 400],
      ] as const) {
        expect(
          (await fetch(`${base}/test`, { method: "POST", headers, body: JSON.stringify(payload) }))
            .status,
        ).toBe(status);
      }
      expect(bot.requests).toEqual([]);
      expect(readPushLogs({ rootDir })).toEqual([]);
    },
    true,
    boundConfig,
  );
});

test("bot 未运行对应账号时透传 503，不在 site 侧伪造发送结果", async () => {
  await withSite(
    async (base, rootDir, bot) => {
      const message = "bot 未运行账号 second，请检查该账号是否启动成功。";
      const response = await fetch(`${base}/test`, {
        method: "POST",
        headers,
        body: JSON.stringify(testPayload),
      });
      expect(response.status).toBe(503);
      expect((await response.json()).data.message).toBe(message);
      expect(bot.requests).toHaveLength(1);
      expect(readPushLogs({ rootDir })).toEqual([]);
    },
    true,
    boundConfig,
    503,
    { ok: false, error: "bot 未运行账号 second，请检查该账号是否启动成功。" },
  );
});

test.each([
  "机器人不是群管理员",
  "@全体成员每日额度已耗尽",
  "官方 QQ 未返回消息 ID，无法确认消息已发送。",
])("bot 发送失败时透传错误，不误报成功：%s", async (message) => {
  await withSite(
    async (base, rootDir, bot) => {
      const response = await fetch(`${base}/test`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...testPayload, kind: "atAll" }),
      });
      expect(response.status).toBe(502);
      expect((await response.json()).data.message).toBe(message);
      expect(bot.requests).toHaveLength(1);
      expect(readPushLogs({ rootDir })).toEqual([]);
    },
    true,
    boundConfig,
    502,
    { ok: false, error: message },
  );
});

test("bot 控制接口不可达时返回 503，不自行发送", async () => {
  await withSite(
    async (base) => {
      vi.stubEnv("NANA_BOT_CONTROL_URL", "http://127.0.0.1:1");
      const response = await fetch(`${base}/test`, {
        method: "POST",
        headers,
        body: JSON.stringify(testPayload),
      });
      expect(response.status).toBe(503);
      expect((await response.json()).statusMessage).toBe("bot 控制接口不可达");
    },
    true,
    boundConfig,
  );
});
