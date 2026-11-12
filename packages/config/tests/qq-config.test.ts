import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { expect, test } from "vite-plus/test";
import { describeQQGroups, parseQQConfig, selectOfficialAccount } from "../src/index.ts";

const mixed = {
  qq: {
    defaultAccount: "nc",
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
  },
  up: [
    { uname: "默认主播", liveMonitorConfig: { notifyGroups: [123] } },
    { uname: "官方主播", qqAccount: "api", liveMonitorConfig: { notifyGroups: [456] } },
  ],
};

test("嵌套账号配置统一为显式通道，默认账号不依赖列表顺序", () => {
  const qq = parseQQConfig(mixed);
  expect(qq).toMatchObject({ provider: "mixed", defaultAccountId: "nc", source: "accounts" });
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

test("旧 NapCat、单账号环境变量与全局官方配置继续解析", () => {
  expect(parseQQConfig({})).toMatchObject({
    provider: "napcat",
    defaultAccountId: "default",
    source: "legacy-napcat",
  });
  expect(
    parseQQConfig({ napcat: { accounts: [{ id: "old", wsUrl: "ws://localhost:1111" }] } }).accounts,
  ).toEqual([expect.objectContaining({ id: "old", provider: "napcat" })]);
  expect(
    parseQQConfig({ qq: { provider: "official", accounts: [{ id: "old-api" }] } }).accounts,
  ).toEqual([expect.objectContaining({ id: "old-api", provider: "official" })]);
  const oldSwitch = {
    qq: { provider: "napcat", accounts: [{ id: "not-active" }] },
    napcat: { accounts: [{ id: "active" }] },
  };
  expect(parseQQConfig(oldSwitch).accounts.map((account) => account.id)).toEqual(["active"]);
});

test("通道冲突、重复账号和无效默认账号在解析入口被拒绝", () => {
  expect(() =>
    parseQQConfig({ qq: { accounts: [{ id: "a", provider: "napcat", official: {} }] } }),
  ).toThrow("不能包含 official");
  expect(() =>
    parseQQConfig({
      qq: {
        accounts: [
          { id: "same", provider: "napcat" },
          { id: "same", provider: "official" },
        ],
      },
    }),
  ).toThrow("重复");
  expect(() => parseQQConfig({ qq: { ...mixed.qq, defaultAccount: "missing" } })).toThrow(
    "默认 QQ 账号",
  );
  expect(() => parseQQConfig({ qq: { accounts: [{ id: "a", provider: "other" }] } })).toThrow(
    "provider",
  );
});

test("全量示例可解析，包含官方与 NapCat 账号以及两类主播路由", () => {
  const raw: unknown = parse(
    readFileSync(new URL("../../../nana.config.yaml.example", import.meta.url), "utf8"),
  );
  const qq = parseQQConfig(raw);
  expect(qq.provider).toBe("mixed");
  expect(qq.defaultAccountId).toBe("main");
  expect(qq.accounts).toHaveLength(4);
  expect(describeQQGroups(raw).map((account) => account.id)).toEqual(["live", "official-second"]);
});
