import { expect, test } from "vite-plus/test";
import {
  groupStreamersByAccount,
  parseNapcatAccounts,
  resolveNapcatAccounts,
} from "../src/accounts.ts";

test("未配置 napcat.accounts 时回退到单账号环境变量", () => {
  const accounts = parseNapcatAccounts(
    {},
    {
      NC_ACCESS_TOKEN: "legacy-token",
      NC_WS_URL: "ws://127.0.0.1:1111",
      ADM_GROUP: "42",
    },
  );

  expect(accounts).toEqual([
    {
      id: "default",
      name: "默认账号",
      wsUrl: "ws://127.0.0.1:1111",
      accessToken: "legacy-token",
      adminGroupId: 42,
    },
  ]);
});

test("多个账号各自从 accessTokenEnv 读取 token，并使用自己的管理群", () => {
  const accounts = parseNapcatAccounts(
    {
      napcat: {
        accounts: [
          {
            id: "main",
            name: "主号",
            wsUrl: "ws://127.0.0.1:1111",
            accessTokenEnv: "NC_ACCESS_TOKEN",
            adminGroup: 10001,
          },
          {
            id: "second",
            wsUrl: "ws://127.0.0.1:2222",
            accessTokenEnv: "NC_ACCESS_TOKEN_2",
            adminGroup: 20002,
          },
        ],
      },
    },
    {
      NC_ACCESS_TOKEN: "token-main",
      NC_ACCESS_TOKEN_2: "token-second",
      ADM_GROUP: "9999",
    },
  );

  expect(accounts).toEqual([
    {
      id: "main",
      name: "主号",
      wsUrl: "ws://127.0.0.1:1111",
      accessToken: "token-main",
      adminGroupId: 10001,
    },
    {
      id: "second",
      name: "second",
      wsUrl: "ws://127.0.0.1:2222",
      accessToken: "token-second",
      adminGroupId: 20002,
    },
  ]);
});

test("账号省略 wsUrl 时沿用旧环境变量，但不再继承 ADM_GROUP", () => {
  const accounts = parseNapcatAccounts(
    {
      napcat: {
        accounts: [{ id: "2227511984", name: "饭总号" }],
      },
    },
    {
      NC_WS_URL: "ws://127.0.0.1:6364",
      NC_ACCESS_TOKEN: "legacy-token",
      ADM_GROUP: "42",
    },
  );

  expect(accounts).toEqual([
    {
      id: "2227511984",
      name: "饭总号",
      wsUrl: "ws://127.0.0.1:6364",
      accessToken: "legacy-token",
      adminGroupId: undefined,
    },
  ]);
});

test("账号可以通过 wsUrlEnv 指向独立的 WS 地址", () => {
  const accounts = parseNapcatAccounts(
    {
      napcat: {
        accounts: [
          { id: "main", wsUrlEnv: "NC_WS_URL", accessToken: "a" },
          {
            id: "2227511984",
            wsUrlEnv: "NC_WS_URL_2",
            accessTokenEnv: "NC_ACCESS_TOKEN_2",
          },
        ],
      },
    },
    {
      NC_WS_URL: "ws://127.0.0.1:1111",
      NC_WS_URL_2: "ws://127.0.0.1:2222",
      NC_ACCESS_TOKEN_2: "token-second",
    },
  );

  expect(accounts.map((account) => [account.id, account.wsUrl])).toEqual([
    ["main", "ws://127.0.0.1:1111"],
    ["2227511984", "ws://127.0.0.1:2222"],
  ]);
});

test("配置了 wsUrlEnv 但变量缺失时直接报错", () => {
  expect(() =>
    parseNapcatAccounts(
      {
        napcat: {
          accounts: [{ id: "second", wsUrlEnv: "NC_WS_URL_2", accessToken: "token" }],
        },
      },
      {},
    ),
  ).toThrow('NapCat 账号 "second" 缺少 WebSocket 地址');
});

test("账号缺少 token 时给出具体账号与变量名", () => {
  expect(() =>
    parseNapcatAccounts(
      {
        napcat: {
          accounts: [
            {
              id: "second",
              wsUrl: "ws://127.0.0.1:2222",
              accessTokenEnv: "NC_ACCESS_TOKEN_2",
            },
          ],
        },
      },
      {},
    ),
  ).toThrow('NapCat 账号 "second" 缺少 access token');
});

test("后续账号缺少连接变量时只跳过该账号，主账号仍可启动", () => {
  const { accounts, unavailable } = resolveNapcatAccounts(
    {
      napcat: {
        accounts: [
          {
            id: "2799397589",
            name: "主号",
            wsUrlEnv: "NC_WS_URL",
            accessTokenEnv: "NC_ACCESS_TOKEN",
            adminGroup: 646247690,
          },
          {
            id: "2227511984",
            name: "饭总号",
            wsUrlEnv: "NC_WS_URL_2",
            accessTokenEnv: "NC_ACCESS_TOKEN_2",
            adminGroup: 1101365727,
          },
        ],
      },
    },
    {
      NC_WS_URL: "ws://127.0.0.1:1111",
      NC_ACCESS_TOKEN: "token-main",
    },
  );

  expect(accounts.map((account) => account.id)).toEqual(["2799397589"]);
  expect(unavailable).toEqual([
    expect.objectContaining({
      id: "2227511984",
      name: "饭总号",
      error: expect.objectContaining({ message: expect.stringContaining("NC_ACCESS_TOKEN_2") }),
    }),
  ]);
});

test("主账号缺少连接变量时直接启动失败", () => {
  expect(() =>
    resolveNapcatAccounts(
      {
        napcat: {
          accounts: [{ id: "main", wsUrlEnv: "NC_WS_URL", accessToken: "token" }],
        },
      },
      {},
    ),
  ).toThrow('NapCat 账号 "main" 缺少 WebSocket 地址');
});

test("重复账号 id 直接报错", () => {
  expect(() =>
    parseNapcatAccounts(
      {
        napcat: {
          accounts: [
            { id: "main", wsUrl: "ws://a", accessToken: "a" },
            { id: "main", wsUrl: "ws://b", accessToken: "b" },
          ],
        },
      },
      {},
    ),
  ).toThrow('重复的账号 id "main"');
});

test("主播按 qqAccount 分组，未配置的落在第一个账号", () => {
  const accounts = parseNapcatAccounts(
    {
      napcat: {
        accounts: [
          { id: "main", wsUrl: "ws://a", accessToken: "a" },
          { id: "second", wsUrl: "ws://b", accessToken: "b" },
        ],
      },
    },
    {},
  );

  const groups = groupStreamersByAccount(
    [
      { streamer: "默认主播" },
      { streamer: "二号机主播", qqAccount: "second" },
      { streamer: "显式主号", qqAccount: "main" },
    ],
    accounts,
  );

  expect(groups.get("main")?.map((streamer) => streamer.streamer)).toEqual([
    "默认主播",
    "显式主号",
  ]);
  expect(groups.get("second")?.map((streamer) => streamer.streamer)).toEqual(["二号机主播"]);
});

test("分配给暂不可用账号的主播会被跳过，不影响其它账号", () => {
  const accounts = parseNapcatAccounts(
    { napcat: { accounts: [{ id: "main", wsUrl: "ws://a", accessToken: "a" }] } },
    {},
  );

  const groups = groupStreamersByAccount(
    [{ streamer: "主号主播" }, { streamer: "暂不可用主播", qqAccount: "second" }],
    accounts,
    { skipAccountIds: new Set(["second"]) },
  );

  expect(groups.get("main")?.map((streamer) => streamer.streamer)).toEqual(["主号主播"]);
});

test("主播引用了不存在的账号时直接报错", () => {
  const accounts = parseNapcatAccounts(
    { napcat: { accounts: [{ id: "main", wsUrl: "ws://a", accessToken: "a" }] } },
    {},
  );

  expect(() =>
    groupStreamersByAccount([{ streamer: "走错门的主播", qqAccount: "missing" }], accounts),
  ).toThrow('qqAccount "missing" 未在当前通道的账号列表');
});
