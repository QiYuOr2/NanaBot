import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp, createRouter, toNodeListener } from "h3";
import { expect, test, vi } from "vite-plus/test";
import getSettings from "../server/api/settings/qq-groups.get.ts";
import putSettings from "../server/api/settings/qq-groups.put.ts";
import getStatus from "../server/api/settings/status.get.ts";
import { recordDiscoveredQQGroup } from "@nana/storage";

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
  process.chdir(rootDir);
  const router = createRouter()
    .get("/status", getStatus)
    .get("/groups", getSettings)
    .put("/groups", putSettings);
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
