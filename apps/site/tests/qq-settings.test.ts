import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp, createRouter, toNodeListener } from "h3";
import { expect, test, vi } from "vite-plus/test";
import getSettings from "../server/api/settings/qq-groups.get.ts";
import putSettings from "../server/api/settings/qq-groups.put.ts";
import getStatus from "../server/api/settings/status.get.ts";
import postTestMessage from "../server/api/settings/qq-groups/test.post.ts";
import { recordDiscoveredQQGroup, readPushLogs } from "@nana/storage";

async function withSite(
  run: (base: string, rootDir: string) => Promise<void>,
  configured = true,
  configuration?: string,
) {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-qq-site-"));
  const cwd = process.cwd();
  mkdirSync(join(rootDir, "apps", "site"), { recursive: true });
  writeFileSync(
    join(rootDir, "nana.config.yaml"),
    configuration ??
      `# 保留配置注释\naccounts:\n  - id: main\n    provider: official\n    official: {}\n    adminGroup: 123\n  - id: nc\n    provider: napcat\n    napcat:\n      wsUrl: ws://localhost:1111\n      accessToken: never-return-this\nup: []\n`,
  );
  if (configured)
    writeFileSync(
      join(rootDir, "apps", "site", ".env"),
      "NANA_SITE_CONFIG_TOKEN=test-management-token-123456\n",
    );
  vi.stubEnv("NANA_SITE_CONFIG_TOKEN", "");
  vi.stubEnv("QQ_BOT_APP_ID", "");
  vi.stubEnv("QQ_BOT_APP_SECRET", "");
  vi.stubEnv("APP_TWO", "");
  vi.stubEnv("SECRET_TWO", "");
  process.chdir(rootDir);
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
    await run(`http://127.0.0.1:${address.port}`, rootDir);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
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
function botCredentials(rootDir: string) {
  mkdirSync(join(rootDir, "apps", "bot"), { recursive: true });
  writeFileSync(
    join(rootDir, "apps", "bot", ".env"),
    'QQ_BOT_APP_ID=first-app\nQQ_BOT_APP_SECRET=first-secret\nAPP_TWO="second-app"\nSECRET_TWO="second-secret"\n',
  );
}
function stubQQRequests(
  messageResult: Record<string, unknown> = { id: "test-message-id" },
  messageStatus = 200,
) {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      requests.push({ url, body: JSON.parse(init.body) as unknown });
      if (url.endsWith("/app/getAppAccessToken"))
        return Response.json({ access_token: "test-access-token", expires_in: 7200 });
      if (url.endsWith("/messages")) return Response.json(messageResult, { status: messageStatus });
      throw new Error(`Unexpected QQ request: ${url}`);
    }),
  );
  return requests;
}

test.each(["text", "atAll"])(
  "测试 %s 经真实 SDK 使用对应账号凭据、保存的群标识与消息类型，并记录成功",
  async (kind) => {
    await withSite(
      async (base, rootDir) => {
        botCredentials(rootDir);
        const requests = stubQQRequests();
        const response = await fetch(`${base}/test`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...testPayload, kind }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ sent: true, messageId: "test-message-id" });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(requests).toHaveLength(2);
        expect(requests[0].body).toEqual({ appId: "second-app", clientSecret: "second-secret" });
        expect(requests[1].url).toBe("https://api.sgroup.qq.com/v2/groups/GROUP_SECOND/messages");
        expect(requests[1].body).toMatchObject({
          msg_type: 0,
          content:
            kind === "atAll"
              ? "<qqbot-at-everyone />NanaBot @全体测试消息：群提醒测试。"
              : "NanaBot 普通测试消息：群消息发送测试。",
        });
        expect(readPushLogs({ rootDir })).toEqual([
          expect.objectContaining({
            account: "second",
            targetId: "GROUP_SECOND",
            target: "第二个机器人的群",
            purpose: "message.test",
            success: true,
          }),
        ]);
      },
      true,
      boundConfig,
    );
  },
);

test("未保存的群、NapCat、未知账号、过期映射与任意目标注入都不会发送", async () => {
  await withSite(
    async (base, rootDir) => {
      botCredentials(rootDir);
      const requests = stubQQRequests();
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
      expect(requests).toEqual([]);
      expect(readPushLogs({ rootDir })).toEqual([]);
    },
    true,
    boundConfig,
  );
});

test("未配置机器人凭据时给出提示并记录失败", async () => {
  await withSite(
    async (base, rootDir) => {
      const requests = stubQQRequests();
      const response = await fetch(`${base}/test`, {
        method: "POST",
        headers,
        body: JSON.stringify(testPayload),
      });
      expect(response.status).toBe(503);
      expect((await response.json()).data.message).toContain("APP_TWO / SECRET_TWO");
      expect(requests).toEqual([]);
      expect(readPushLogs({ rootDir })[0]).toMatchObject({
        success: false,
        purpose: "message.test",
      });
    },
    true,
    boundConfig,
  );
});

test.each([
  { code: 40034105, message: "机器人不是群管理员" },
  { code: 40034100, message: "@全体成员每日额度已耗尽" },
  {},
])("平台拒绝或缺少消息 ID 不误报成功，@全体失败不降级重发：%j", async (result) => {
  await withSite(
    async (base, rootDir) => {
      botCredentials(rootDir);
      const requests = stubQQRequests(result);
      const response = await fetch(`${base}/test`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...testPayload, kind: "atAll" }),
      });
      expect(response.status).toBe(502);
      expect(requests.filter((request) => request.url.endsWith("/messages"))).toHaveLength(1);
      expect(readPushLogs({ rootDir })[0]).toMatchObject({
        success: false,
        purpose: "message.test",
      });
    },
    true,
    boundConfig,
  );
});

test("发送异常中的机器人密钥不会返回页面或写入推送记录", async () => {
  await withSite(
    async (base, rootDir) => {
      botCredentials(rootDir);
      stubQQRequests({ code: 123, message: "invalid second-secret" });
      const response = await fetch(`${base}/test`, {
        method: "POST",
        headers,
        body: JSON.stringify(testPayload),
      });
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("second-secret");
      expect(readPushLogs({ rootDir })[0].error).not.toContain("second-secret");
    },
    true,
    boundConfig,
  );
});
