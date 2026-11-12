import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { expect, test } from "vite-plus/test";
import { describeQQGroups, parseQQConfig, selectOfficialAccount } from "../src/index.ts";

const mixed = {
  accounts: [
    {
      id: "api",
      provider: "official",
      official: { appIdEnv: "APP", appSecretEnv: "SECRET", sandbox: true },
    },
    {
      id: "nc",
      provider: "napcat",
      napcat: { wsUrlEnv: "WS", accessTokenEnv: "TOKEN" },
      adminGroup: 123,
    },
  ],
  up: [
    { uname: "未指定账号主播", liveMonitorConfig: { notifyGroups: [123] } },
    { uname: "官方主播", qqAccount: "api", liveMonitorConfig: { notifyGroups: [456] } },
  ],
};

test("顶层账号配置统一为显式通道，只为明确归属的主播枚举目标群", () => {
  const qq = parseQQConfig(mixed);
  expect(qq).toMatchObject({ provider: "mixed" });
  expect(qq.accounts[0]).toMatchObject({
    provider: "official",
    appIdEnv: "APP",
    appSecretEnv: "SECRET",
    sandbox: true,
  });
  expect(qq.accounts[1]).toMatchObject({
    provider: "napcat",
    wsUrlEnv: "WS",
    accessTokenEnv: "TOKEN",
    adminGroup: 123,
  });
  expect(
    describeQQGroups(mixed).map((account) => [account.id, account.groups.map((group) => group.id)]),
  ).toEqual([["api", ["456"]]]);
  expect(selectOfficialAccount(mixed).id).toBe("api");
  expect(() => selectOfficialAccount(mixed, "nc")).toThrow("使用 NapCat");
});

test("账号列表必须配置在顶层，空配置与旧结构不再读取", () => {
  expect(() => parseQQConfig({})).toThrow();
  expect(() => parseQQConfig({ qq: { accounts: mixed.accounts } })).toThrow();
  expect(() => parseQQConfig({ napcat: { accounts: [{ id: "old" }] } })).toThrow();
});

test("顶层空列表、缺少通道、通道冲突与重复账号在解析入口被拒绝", () => {
  expect(() => parseQQConfig({ accounts: [] })).toThrow();
  expect(() => parseQQConfig({ accounts: [{ id: "a" }] })).toThrow("provider");
  expect(() =>
    parseQQConfig({ accounts: [{ id: "a", provider: "napcat", official: {} }] }),
  ).toThrow();
  expect(() =>
    parseQQConfig({
      accounts: [
        {
          id: "same",
          provider: "napcat",
          napcat: { wsUrl: "ws://localhost:1111", accessToken: "token" },
        },
        { id: "same", provider: "official", official: {} },
      ],
    }),
  ).toThrow("重复");
  expect(() => parseQQConfig({ accounts: [{ id: "a", provider: "other" }] })).toThrow("provider");
});

test("全量示例使用顶层 accounts，包含官方与 NapCat 账号以及两类主播路由", () => {
  const raw = parse(
    readFileSync(new URL("../../../nana.config.yaml.example", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  expect(raw).not.toHaveProperty("qq");
  expect(raw).not.toHaveProperty("defaultAccount");
  const qq = parseQQConfig(raw);
  expect(qq.provider).toBe("mixed");
  expect(qq.accounts).toHaveLength(4);
  expect(describeQQGroups(raw).map((account) => account.id)).toEqual(["live", "official-second"]);
});
