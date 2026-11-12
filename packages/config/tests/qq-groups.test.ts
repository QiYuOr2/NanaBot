import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { parse } from "yaml";
import { describeQQGroups, loadOfficialGroups, saveQQGroupMapping } from "../src/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const source = `# 顶部注释
accounts:
  - id: main
    provider: official
    official: {}
    adminGroup: 123
    groups:
      123: # 保留群注释
        openid: OLD
        name: 旧群名
  - id: second
    provider: official
    official:
      appIdEnv: APP2
      appSecretEnv: SECRET2
  - id: nc
    provider: napcat
    napcat:
      wsUrl: ws://localhost:1111
      accessToken: keep-this
up:
  - uname: 饭总
    qqAccount: main
    liveMonitorConfig:
      notifyGroups: [123, 456]
    wordcloud:
      notifyGroups: [456]
  - uname: 另一位
    qqAccount: second
    liveMonitorConfig:
      notifyGroups: [789]
`;
function root() {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-qq-config-"));
  roots.push(rootDir);
  const file = join(rootDir, "nana.config.yaml");
  writeFileSync(file, source);
  return { rootDir, file };
}

test("列出各账号业务目标，包含未映射的通知群与词云群，不输出凭据", () => {
  const accounts = describeQQGroups(parse(source));
  expect(accounts[0].groups).toEqual([
    { id: "123", name: "旧群名", openid: "OLD", uses: ["管理群", "饭总 · 开播通知"] },
    { id: "456", name: "", openid: null, uses: ["饭总 · 开播通知", "饭总 · 词云"] },
  ]);
  expect(accounts[1].groups.map((group) => group.id)).toEqual(["789"]);
  expect(JSON.stringify(accounts)).not.toContain("keep-this");
});

test("单群更新保留注释和其它账号，运行中读取立即生效", () => {
  const { rootDir, file } = root();
  saveQQGroupMapping(
    { accountId: "main", groupId: "123", openid: "NEW", name: "新群名", expectedOpenid: "OLD" },
    rootDir,
  );
  const content = readFileSync(file, "utf8");
  expect(content).toContain("# 顶部注释");
  expect(content).toContain("# 保留群注释");
  expect(content).toContain("keep-this");
  expect(parse(content).up).toEqual(parse(source).up);
  expect(loadOfficialGroups("main", rootDir)["123"]).toEqual({ openid: "NEW", name: "新群名" });
  expect(loadOfficialGroups("second", rootDir)).toEqual({});
  saveQQGroupMapping(
    { accountId: "main", groupId: "456", openid: "CANDIDATE", name: "", expectedOpenid: null },
    rootDir,
  );
  expect(loadOfficialGroups("main", rootDir)["456"]).toEqual({ openid: "CANDIDATE" });
});

test("拒绝过期页面覆盖、跨账号目标、重复绑定和额外字段", () => {
  const { rootDir, file } = root();
  const base = {
    accountId: "main",
    groupId: "123",
    openid: "NEW",
    name: "新群名",
    expectedOpenid: "OLD",
  };
  expect(() => saveQQGroupMapping({ ...base, expectedOpenid: null }, rootDir)).toThrow(
    "已被其他操作修改",
  );
  expect(() => saveQQGroupMapping({ ...base, groupId: "789" }, rootDir)).toThrow("未在当前账号");
  expect(() =>
    saveQQGroupMapping({ ...base, groupId: "456", openid: "OLD", expectedOpenid: null }, rootDir),
  ).toThrow("另一个群");
  expect(() => saveQQGroupMapping({ ...base, appSecret: "forbidden" }, rootDir)).toThrow();
  expect(readFileSync(file, "utf8")).toBe(source);
});
