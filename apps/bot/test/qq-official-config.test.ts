import { expect, test } from "vite-plus/test";
import {
  parseQQConfig,
  resolveOfficialAccounts,
  validateOfficialTargets,
} from "../src/qq/config.ts";
import { groupStreamersByAccount } from "../src/accounts.ts";

test("旧配置仍使用 NapCat；官方模式必须显式提供账号", () => {
  expect(parseQQConfig({ napcat: {} }).provider).toBe("napcat");
  expect(() => parseQQConfig({ qq: { provider: "other" } })).toThrow();
  expect(() => parseQQConfig({ qq: { provider: "official" } })).toThrow("qq.accounts");
});

test("官方多账号独立解析环境变量，沿用主播归属与数字群别名", () => {
  const qq = parseQQConfig({
    qq: {
      provider: "official",
      accounts: [
        { id: "main", adminGroup: 123, groups: { 123: { openid: "GROUP_A", name: "管理群" } } },
        { id: "second", appIdEnv: "APP2", appSecretEnv: "SECRET2", sandbox: true },
      ],
    },
  });
  const accounts = resolveOfficialAccounts(qq.accounts, {
    QQ_BOT_APP_ID: " app1 ",
    QQ_BOT_APP_SECRET: "secret1",
    APP2: "app2",
    SECRET2: "secret2",
  });
  expect(accounts[0]).toMatchObject({ name: "main", appId: "app1", adminGroupId: 123 });
  expect(accounts[1]).toMatchObject({ appId: "app2", appSecret: "secret2", sandbox: true });
  const streamer = { streamer: "饭总", qqAccount: "second" };
  expect(groupStreamersByAccount([streamer], accounts).get("second")).toEqual([streamer]);
  expect(() => validateOfficialTargets(accounts[0], [123])).not.toThrow();
  expect(() => validateOfficialTargets(accounts[0], [456])).toThrow("group_openid");
  expect(() => validateOfficialTargets({ ...accounts[0], groups: {} }, [])).toThrow("123");
});

test("缺少凭据、重复账号、同一机器人冒充多个账号时明确失败", () => {
  const entries = [{ id: "a" }, { id: "b", appIdEnv: "APP2", appSecretEnv: "SECRET2" }];
  const qq = parseQQConfig({ qq: { accounts: entries } });
  expect(() => resolveOfficialAccounts(qq.accounts, { NC_ACCESS_TOKEN: "legacy" })).toThrow(
    "QQ_BOT_APP_ID",
  );
  expect(() =>
    resolveOfficialAccounts(qq.accounts, {
      QQ_BOT_APP_ID: "app1",
      QQ_BOT_APP_SECRET: "secret",
      APP2: "app1",
      SECRET2: "secret2",
    }),
  ).toThrow("相同 AppID");
  expect(() => parseQQConfig({ qq: { accounts: [entries[0], entries[0]] } })).toThrow("重复");
  expect(() =>
    parseQQConfig({ qq: { accounts: [{ id: "a", groups: { abc: { openid: "x" } } }] } }),
  ).toThrow();
});
