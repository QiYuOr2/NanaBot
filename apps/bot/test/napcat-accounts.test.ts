import { expect, test } from "vite-plus/test";
import { parseQQConfig } from "@nana/config";
import { resolveQQAccounts, groupStreamersByAccount } from "../src/accounts.ts";

const account = (id: string, napcat: Record<string, string>, adminGroup?: number) => ({
  id,
  provider: "napcat",
  napcat,
  adminGroup,
});

test("多个 NapCat 账号从各自的环境变量读取连接参数与管理群", () => {
  const { accounts } = resolveQQAccounts(
    {
      accounts: [
        account("main", { wsUrlEnv: "WS1", accessTokenEnv: "TOKEN1" }, 10001),
        account("second", { wsUrlEnv: "WS2", accessTokenEnv: "TOKEN2" }, 20002),
      ],
    },
    { WS1: "ws://localhost:1111", TOKEN1: "first", WS2: "ws://localhost:2222", TOKEN2: "second" },
  );
  expect(accounts).toEqual([
    {
      id: "main",
      name: "main",
      provider: "napcat",
      wsUrl: "ws://localhost:1111",
      accessToken: "first",
      adminGroupId: 10001,
    },
    {
      id: "second",
      name: "second",
      provider: "napcat",
      wsUrl: "ws://localhost:2222",
      accessToken: "second",
      adminGroupId: 20002,
    },
  ]);
});

test("直接填写的连接参数优先，管理群只使用账号配置", () => {
  const { accounts } = resolveQQAccounts(
    {
      accounts: [
        account("main", {
          wsUrl: "ws://localhost:1111",
          wsUrlEnv: "WS",
          accessToken: "direct",
          accessTokenEnv: "TOKEN",
        }),
      ],
    },
    { WS: "ws://localhost:2222", TOKEN: "env" },
  );
  expect(accounts[0]).toMatchObject({
    wsUrl: "ws://localhost:1111",
    accessToken: "direct",
    adminGroupId: undefined,
  });
});

test("停用 NapCat 不读取凭据，其主播跳过且不改发；全部停用也可以启动面板控制服务", () => {
  const config = {
    accounts: [
      {
        ...account("stopped", { wsUrlEnv: "MISSING_URL", accessTokenEnv: "MISSING_TOKEN" }),
        enabled: false,
      },
      account("active", { wsUrl: "ws://localhost:1111", accessToken: "token" }),
    ],
  };
  const result = resolveQQAccounts(config, {});
  expect(result.disabled).toEqual(["stopped"]);
  expect(result.unavailable).toEqual([]);
  expect(result.accounts.map((entry) => entry.id)).toEqual(["active"]);
  expect(
    [
      ...groupStreamersByAccount(
        [{ streamer: "停用主播", qqAccount: "stopped" }],
        result.accounts,
        { skipAccountIds: new Set(result.disabled) },
      ).values(),
    ].flat(),
  ).toEqual([]);
  expect(resolveQQAccounts({ accounts: [config.accounts[0]] }, {}).accounts).toEqual([]);
});

test("连接参数必须显式配置，不再创建环境变量单账号", () => {
  expect(() =>
    resolveQQAccounts({}, { NC_ACCESS_TOKEN: "token", NC_WS_URL: "ws://localhost:1111" }),
  ).toThrow();
  expect(() => parseQQConfig({ accounts: [account("main", {})] })).toThrow();
  expect(() => parseQQConfig({ accounts: [account("main", { accessToken: "token" })] })).toThrow();
});

test.each(["first", "second"])("账号 %s 缺少指定变量时只跳过自己", (missing) => {
  const result = resolveQQAccounts(
    {
      accounts: [
        account("first", { wsUrlEnv: "WS1", accessTokenEnv: "TOKEN1" }),
        account("second", { wsUrlEnv: "WS2", accessTokenEnv: "TOKEN2" }),
      ],
    },
    missing === "first"
      ? { WS2: "ws://localhost:2222", TOKEN2: "second" }
      : { WS1: "ws://localhost:1111", TOKEN1: "first" },
  );
  expect(result.unavailable[0].id).toBe(missing);
  expect(result.accounts.map((item) => item.id)).toEqual([
    missing === "first" ? "second" : "first",
  ]);
});

test("指定变量缺失时不借用其他环境变量，错误标明具体账号", () => {
  expect(() =>
    resolveQQAccounts(
      { accounts: [account("main", { wsUrlEnv: "CUSTOM_WS", accessTokenEnv: "CUSTOM_TOKEN" })] },
      { NC_ACCESS_TOKEN: "other", NC_WS_URL: "ws://localhost:1111" },
    ),
  ).toThrow("没有可启动");
  const result = resolveQQAccounts(
    {
      accounts: [
        account("bad-url", { wsUrlEnv: "MISSING_WS", accessToken: "token" }),
        account("good", { wsUrl: "ws://localhost:1111", accessToken: "token" }),
      ],
    },
    {},
  );
  expect(result.unavailable[0].error.message).toContain(
    'NapCat 账号 "bad-url" 缺少 WebSocket 地址',
  );
  expect(result.unavailable[0].error.message).toContain("MISSING_WS");
});

test("主播只按显式 qqAccount 分组，缺失账号不回退，停用账号跳过，未知账号报错", () => {
  const accounts = [{ id: "main" }, { id: "second" }];
  const groups = groupStreamersByAccount(
    [
      { streamer: "未指定账号" },
      { streamer: "主号主播", qqAccount: "main" },
      { streamer: "副号主播", qqAccount: "second" },
      { streamer: "停用账号主播", qqAccount: "offline" },
    ],
    accounts,
    { skipAccountIds: new Set(["offline"]) },
  );
  expect(groups.get("main")?.map((item) => item.streamer)).toEqual(["主号主播"]);
  expect(groups.get("second")?.map((item) => item.streamer)).toEqual(["副号主播"]);
  expect(() =>
    groupStreamersByAccount([{ streamer: "未知账号", qqAccount: "missing" }], accounts),
  ).toThrow('qqAccount "missing"');
});
