import { expect, test, vi } from "vite-plus/test";
import {
  resolveQQAccounts,
  groupStreamersByAccount,
  createAccountApp,
  startAccountApps,
} from "../src/accounts.ts";
import { createApp } from "../src/core/createApp.ts";
import { createOfficialApp } from "../src/qq/app.ts";
import type { BotApp } from "../src/core/app.ts";

vi.mock("../src/core/createApp.ts", () => ({ createApp: vi.fn() }));
vi.mock("../src/qq/app.ts", () => ({ createOfficialApp: vi.fn() }));
const configuration = {
  accounts: [
    { id: "nc", provider: "napcat", napcat: { wsUrlEnv: "NC_URL", accessTokenEnv: "NC_TOKEN" } },
    { id: "api", provider: "official", official: { appIdEnv: "APP", appSecretEnv: "SECRET" } },
  ],
};
const env = { NC_URL: "ws://localhost:1111", NC_TOKEN: "token", APP: "appid", SECRET: "secret" };
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

test("两类账号在顶层列表解析，只有指定账号的主播参与路由", () => {
  const result = resolveQQAccounts(configuration, env);
  expect(result.accounts.map((account) => [account.id, account.provider])).toEqual([
    ["nc", "napcat"],
    ["api", "official"],
  ]);
  const grouped = groupStreamersByAccount(
    [
      { streamer: "未指定账号主播" },
      { streamer: "官方主播", qqAccount: "api" },
      { streamer: "NC主播", qqAccount: "nc" },
    ],
    result.accounts,
  );
  expect(grouped.get("api")?.map((item) => item.streamer)).toEqual(["官方主播"]);
  expect(grouped.get("nc")?.map((item) => item.streamer)).toEqual(["NC主播"]);
});

test.each(["api", "nc"])("账号 %s 缺少凭据时隔离，主播不会改发到另一个通道", (missing) => {
  const availableEnv =
    missing === "api"
      ? { NC_URL: env.NC_URL, NC_TOKEN: env.NC_TOKEN }
      : { APP: env.APP, SECRET: env.SECRET };
  const result = resolveQQAccounts(configuration, availableEnv);
  expect(result.unavailable[0].id).toBe(missing);
  const grouped = groupStreamersByAccount(
    [
      { streamer: "未指定账号主播" },
      { streamer: "官方主播", qqAccount: "api" },
      { streamer: "NC主播", qqAccount: "nc" },
    ],
    result.accounts,
    {
      skipAccountIds: new Set(result.unavailable.map((account) => account.id)),
    },
  );
  expect([...grouped.values()].flat().map((item) => item.streamer)).toEqual(
    missing === "api" ? ["NC主播"] : ["官方主播"],
  );
});

test("所有账号缺少凭据、重复官方 AppID 或路由错误会明确失败", () => {
  expect(() => resolveQQAccounts(configuration, {})).toThrow("没有可启动的 QQ 账号");
  expect(() =>
    resolveQQAccounts(
      {
        accounts: [
          {
            id: "a",
            provider: "official",
            official: { appIdEnv: "APP", appSecretEnv: "SECRET" },
          },
          {
            id: "b",
            provider: "official",
            official: { appIdEnv: "APP2", appSecretEnv: "SECRET2" },
          },
        ],
      },
      { ...env, APP2: "appid", SECRET2: "second" },
    ),
  ).toThrow("相同 AppID");
  const result = resolveQQAccounts(configuration, env);
  expect(() =>
    groupStreamersByAccount([{ streamer: "无效路由", qqAccount: "missing" }], result.accounts),
  ).toThrow("missing");
});

test("应用工厂按 provider 分派，并传递各自独立的连接参数", () => {
  const { accounts } = resolveQQAccounts(configuration, env);
  const nc = fakeApp("nc");
  const official = fakeApp("api");
  vi.mocked(createApp).mockReturnValue(nc as never);
  vi.mocked(createOfficialApp).mockReturnValue(official);
  expect(createAccountApp(accounts[0], { logger })).toBe(nc);
  expect(createApp).toHaveBeenCalledWith(
    expect.objectContaining({
      websocket: expect.objectContaining({ baseUrl: env.NC_URL, accessToken: env.NC_TOKEN }),
      handleSignals: false,
    }),
  );
  expect(createAccountApp(accounts[1], { logger })).toBe(official);
  expect(createOfficialApp).toHaveBeenCalledWith(
    expect.objectContaining({
      account: expect.objectContaining({ id: "api", provider: "official", appId: env.APP }),
    }),
  );
});

test("一个连接启动或清理失败，不会阻止另一个连接继续运行", async () => {
  expect(await startAccountApps([])).toEqual([]);
  const good = { app: fakeApp("nc"), logger };
  const bad = { app: fakeApp("api"), logger };
  bad.app.start = vi.fn(() => Promise.reject(new Error("invalid official credentials")));
  const badStop = vi.fn(() => Promise.reject(new Error("cleanup failed")));
  const goodStop = vi.spyOn(good.app, "stop");
  bad.app.stop = badStop;
  expect(await startAccountApps([bad, good])).toEqual([good]);
  expect(badStop).toHaveBeenCalledOnce();
  expect(goodStop).not.toHaveBeenCalled();
  good.app.start = vi.fn(() => Promise.reject(new Error("NC unavailable")));
  await expect(startAccountApps([good])).rejects.toThrow("所有 QQ 账号均启动失败");
});

function fakeApp(accountId: string): BotApp {
  const app: BotApp = {
    accountId,
    adminGroupId: undefined,
    get connected() {
      return false;
    },
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    use() {
      return app;
    },
    onConnected() {
      return () => {};
    },
    onMessage() {
      return () => {};
    },
    async replyMessage() {},
    async sendTyping() {},
    onConnectionState() {
      return () => {};
    },
    onHeartbeat() {
      return () => {};
    },
    async sendMessage() {},
    onCleanup() {},
    async sendAdminText() {},
    async sendAdminMsg() {},
    async sendGroupMsg() {
      return "";
    },
  };
  return app;
}
