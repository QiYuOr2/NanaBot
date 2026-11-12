import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { expect, test, vi } from "vite-plus/test";
import { parseQQConfig, readConfig, type NanaConfig } from "@nana/config";
import { resolveQQAccounts, groupStreamersByAccount } from "../src/accounts.ts";
import { loadMonitorConfig } from "../src/monitor/config.ts";
import { loadWordCloudConfig } from "../src/danmu/config.ts";
import { loadOfflineDetectorConfig } from "../src/offline/config.ts";

vi.mock("@nana/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nana/config")>()),
  readConfig: vi.fn(),
}));

test("全量示例通过实际业务配置加载器，账号、通知、词云与告警可以一起使用", () => {
  const config = parse(
    readFileSync(new URL("../../../nana.config.yaml.example", import.meta.url), "utf8"),
  ) as NanaConfig;
  vi.mocked(readConfig).mockReturnValue(config);
  const result = resolveQQAccounts(config, {
    NC_WS_URL: "ws://localhost:1111",
    NC_ACCESS_TOKEN: "first-token",
    NC_WS_URL_2: "ws://localhost:2222",
    NC_ACCESS_TOKEN_2: "second-token",
    QQ_BOT_APP_ID: "first-app",
    QQ_BOT_APP_SECRET: "first-secret",
    QQ_BOT_APP_ID_2: "second-app",
    QQ_BOT_APP_SECRET_2: "second-secret",
  });
  expect(result.unavailable).toEqual([]);
  expect(result.accounts).toHaveLength(4);
  expect(parseQQConfig(config).accounts).toHaveLength(4);
  const { streamers } = loadMonitorConfig();
  expect(streamers).toHaveLength(1);
  expect(groupStreamersByAccount(streamers, result.accounts).get("live")).toEqual([
    expect.objectContaining({
      notifyEnabled: true,
      notifyGroups: [100000003],
      wordCloud: { enabled: true, notifyGroups: [100000004] },
    }),
  ]);
  expect(loadWordCloudConfig()).toMatchObject({ topN: 60, pollIntervalMs: 300000 });
  expect(loadOfflineDetectorConfig()).toMatchObject({
    notifier: { address: "admin@example.com", smtp: { port: 587, secure: false } },
    confirmCount: 3,
    notifyRecovery: true,
  });
});

test("根级 message 非法配置由 parseQQConfig 明确拒绝", () => {
  expect(() =>
    parseQQConfig({
      message: { rules: { items: [{ id: "bad", type: "regex", pattern: "(", response: "x" }] } },
      accounts: [
        {
          id: "main",
          provider: "napcat",
          napcat: { wsUrl: "ws://localhost", accessToken: "token" },
        },
      ],
    }),
  ).toThrow(/message.*正则表达式无效|正则表达式无效/);
});
