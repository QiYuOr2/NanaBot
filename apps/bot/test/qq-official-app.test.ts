import { expect, test, vi } from "vite-plus/test";
import { createOfficialApp } from "../src/qq/app.ts";
import { parseQQConfig, resolveOfficialAccounts } from "../src/qq/config.ts";
import { offlineDetectorFeature } from "../src/offline/feature.ts";
import type { OfflineState } from "@nana/offline-detector";
import type { NotifyMessage } from "@nana/notify";

function harness(readyOnStart = true) {
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
  const bot = {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    start: vi.fn(() => {
      if (readyOnStart) queueMicrotask(() => emit("ready", {}));
      return run;
    }),
    stop: vi.fn(() => resolveRun()),
    sendText: vi.fn(),
    sendImage: vi.fn(),
  };
  const [account] = resolveOfficialAccounts(
    parseQQConfig({ qq: { accounts: [{ id: "official" }] } }).accounts,
    { QQ_BOT_APP_ID: "test-app", QQ_BOT_APP_SECRET: "test-secret" },
  );
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = createOfficialApp({ account, bot: bot as never, logger, connectTimeoutMs: 5 });
  return { app, bot, emit, fail: (error: Error) => rejectRun(error) };
}

test("SDK start 长期 pending 时 READY 能完成启动，停机等待连接退出并只清理一次", async () => {
  const { app, bot, emit } = harness();
  const cleanup = vi.fn();
  const connected = vi.fn();
  app.onConnected(connected);
  app.use({ name: "test", setup: () => cleanup }, {});
  await app.start();
  expect(connected).toHaveBeenCalledOnce();
  emit("resumed", {});
  expect(connected).toHaveBeenCalledTimes(2);
  await Promise.all([app.stop(), app.stop()]);
  expect(bot.stop).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  emit("ready", {});
  expect(connected).toHaveBeenCalledTimes(2);
});

test("凭据启动错误向入口传播，清理已经注册的业务", async () => {
  const { app, bot } = harness(false);
  const error = new Error("invalid app secret");
  bot.start.mockImplementation(() => Promise.reject(error));
  const cleanup = vi.fn();
  app.use({ name: "test", setup: () => cleanup }, {});
  await expect(app.start()).rejects.toBe(error);
  await app.stop();
  expect(cleanup).toHaveBeenCalledOnce();
});

test("暂未连上时保持重试，运行期不可恢复错误会停止业务并清理", async () => {
  const { app, bot, emit, fail } = harness(false);
  const cleanup = vi.fn();
  const connected = vi.fn();
  app.onConnected(connected);
  app.use({ name: "test", setup: () => cleanup }, {});
  await app.start();
  expect(bot.stop).not.toHaveBeenCalled();
  emit("ready", {});
  expect(connected).toHaveBeenCalledOnce();
  fail(new Error("GATEWAY_FATAL_CLOSE"));
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  await app.stop();
  expect(bot.stop).toHaveBeenCalledOnce();
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
    emit("resumed", {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sent).toEqual([]);
    emit("disconnected", { code: 1006, willReconnect: true });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    emit("resumed", {});
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).toContain("离线");
    expect(sent[1]).toContain("恢复");
  } finally {
    await app.stop();
  }
});
