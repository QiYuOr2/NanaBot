import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDiscoveredQQGroups } from "@nana/storage";
import { createOfficialApp } from "../src/qq/app.ts";
import { parseQQConfig, resolveOfficialAccounts } from "../src/qq/config.ts";
import { offlineDetectorFeature } from "../src/offline/feature.ts";
import type { OfflineState } from "@nana/offline-detector";
import type { NotifyMessage } from "@nana/notify";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function harness(readyOnStart = true) {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-official-app-"));
  roots.push(rootDir);
  writeFileSync(join(rootDir, "nana.config.yaml"), "{}");
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  let resolveRun: () => void;
  let rejectRun: (error: Error) => void;
  const run = new Promise<void>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  const emit = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) handler(...args);
  };
  const client = {
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = [...(handlers.get(event) ?? []), handler];
      handlers.set(event, list);
      return () => {
        handlers.set(
          event,
          list.filter((entry) => entry !== handler),
        );
      };
    },
    start: vi.fn(() => {
      if (readyOnStart) queueMicrotask(() => emit("connected"));
      return run;
    }),
    stop: vi.fn(() => resolveRun()),
    sendGroupMessage: vi.fn(),
  };
  const [account] = resolveOfficialAccounts(
    parseQQConfig({ qq: { accounts: [{ id: "official" }] } }).accounts,
    { QQ_BOT_APP_ID: "test-app", QQ_BOT_APP_SECRET: "test-secret" },
  );
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = createOfficialApp({
    account,
    client: client as never,
    logger,
    storage: { rootDir },
    connectTimeoutMs: 5,
  });
  return { app, client, emit, rootDir, fail: (error: Error) => rejectRun(error) };
}

test("运行中收到群消息会保存群标识供 site 绑定，不记录群聊正文", async () => {
  const { app, emit, rootDir } = harness();
  try {
    await app.start();
    emit("groupDiscovered", { openid: "GROUP_A", source: "message", content: "不应保存的正文" });
    emit("groupDiscovered", { openid: "GROUP_B", source: "added" });
    const groups = readDiscoveredQQGroups("official", { rootDir });
    expect(groups.map((group) => group.openid).sort()).toEqual(["GROUP_A", "GROUP_B"]);
    expect(JSON.stringify(groups)).not.toContain("不应保存");
    expect(readDiscoveredQQGroups("another", { rootDir })).toEqual([]);
  } finally {
    await app.stop();
  }
});

test("SDK start 长期 pending 时 READY 能完成启动，停机等待连接退出并只清理一次", async () => {
  const { app, client, emit } = harness();
  const cleanup = vi.fn();
  const connected = vi.fn();
  app.onConnected(connected);
  app.use({ name: "test", setup: () => cleanup }, {});
  await app.start();
  expect(connected).toHaveBeenCalledOnce();
  emit("connected");
  expect(connected).toHaveBeenCalledTimes(2);
  await Promise.all([app.stop(), app.stop()]);
  expect(client.stop).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  emit("connected");
  expect(connected).toHaveBeenCalledTimes(2);
});

test("凭据启动错误向入口传播，清理已经注册的业务", async () => {
  const { app, client } = harness(false);
  const error = new Error("invalid app secret");
  client.start.mockImplementation(() => Promise.reject(error));
  const cleanup = vi.fn();
  app.use({ name: "test", setup: () => cleanup }, {});
  await expect(app.start()).rejects.toBe(error);
  await app.stop();
  expect(cleanup).toHaveBeenCalledOnce();
});

test("暂未连上时保持重试，运行期不可恢复错误会停止业务并清理", async () => {
  const { app, client, emit, fail } = harness(false);
  const cleanup = vi.fn();
  const connected = vi.fn();
  app.onConnected(connected);
  app.use({ name: "test", setup: () => cleanup }, {});
  await app.start();
  expect(client.stop).not.toHaveBeenCalled();
  emit("connected");
  expect(connected).toHaveBeenCalledOnce();
  fail(new Error("GATEWAY_FATAL_CLOSE"));
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  await app.stop();
  expect(client.stop).toHaveBeenCalledOnce();
});

test("官方断连告警忽略短暂抖动，持续离线告警并在 RESUMED 时恢复", async () => {
  const { app, emit } = harness();
  const sent: string[] = [];
  let stored: OfflineState | undefined;
  app.use(offlineDetectorFeature, {
    notifier: {
      async send(message: NotifyMessage) {
        sent.push(message.subject);
      },
    },
    store: {
      read: () => stored,
      write: (value: OfflineState) => {
        stored = value;
      },
    },
    recordAlert: () => {},
    recoveryFallbackMs: 15,
    notifyRecovery: true,
  });
  try {
    await app.start();
    emit("disconnected", { code: 1006, willReconnect: true });
    emit("connected");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sent).toEqual([]);
    emit("disconnected", { code: 1006, willReconnect: true });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    emit("connected");
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).toContain("离线");
    expect(sent[1]).toContain("恢复");
  } finally {
    await app.stop();
  }
});
