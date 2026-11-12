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
import type { QQClientPort, QQIncomingMessage } from "@nana/qq";
import type { IncomingMessage } from "../src/message/types.ts";

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
    replyMessage: vi.fn(async () => ({ id: "reply" })),
    sendGroupMessage: vi.fn(async () => ({ id: "group" })),
    sendPrivateMessage: vi.fn(async () => ({ id: "private" })),
  };
  const [account] = resolveOfficialAccounts(
    parseQQConfig({ accounts: [{ id: "official", provider: "official", official: {} }] }).accounts,
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
  return { app, client, emit, logger, rootDir, account, fail: (error: Error) => rejectRun(error) };
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

test("断线保留 SDK 原因并记录恢复耗时，恢复后继续广播连接状态", async () => {
  const { app, emit, logger } = harness();
  const connected = vi.fn();
  app.onConnected(connected);
  try {
    await app.start();
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    emit("disconnected", {
      code: 1000,
      reason: "Gateway requested reconnect",
      willReconnect: true,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "[官方 QQ] 连接断开（1000），等待自动重连；原因：Gateway requested reconnect",
    );
    clock.mockReturnValue(102_000);
    emit("connected");
    expect(logger.info).toHaveBeenCalledWith("[官方 QQ] 连接已恢复（中断 2.0 秒）");
    expect(connected).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  } finally {
    vi.restoreAllMocks();
    await app.stop();
  }
});

function officialIncoming(overrides: Partial<QQIncomingMessage> = {}): QQIncomingMessage {
  return {
    id: "msg-1",
    kind: "group",
    eventType: "GROUP_AT_MESSAGE_CREATE",
    content: "/status",
    senderId: "USER",
    isAtBot: true,
    replyTarget: { scope: "group", targetId: "GROUP", msgId: "msg-1" },
    ...overrides,
  };
}

test("官方入站消息只由当前账号处理，被动回复保留原消息 ID 且不主动补发", async () => {
  let currentTime = 1_000;
  const rootDir = mkdtempSync(join(tmpdir(), "nana-official-adapter-"));
  roots.push(rootDir);
  writeFileSync(join(rootDir, "nana.config.yaml"), "{}");
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const sent: string[] = [];
  let resolveRun: () => void;
  const run = new Promise<void>((resolve) => {
    resolveRun = resolve;
  });
  const client: QQClientPort = {
    on(event, listener) {
      const list = handlers.get(event) ?? [];
      list.push(listener as (...args: unknown[]) => void);
      handlers.set(event, list);
      return () => {
        handlers.set(
          event,
          list.filter((entry) => entry !== listener),
        );
      };
    },
    start: () => run,
    stop: () => resolveRun(),
    async sendGroupMessage() {
      sent.push("proactive-group");
      return { id: "group" };
    },
    async sendPrivateMessage() {
      sent.push("proactive-private");
      return { id: "private" };
    },
    async replyMessage(message, parts) {
      sent.push(
        `${message.replyTarget.scope}:${message.replyTarget.targetId}:${message.replyTarget.msgId}`,
      );
      expect(parts).toEqual([{ type: "text", text: "ok" }]);
      return { id: "reply" };
    },
  };
  const [account] = resolveOfficialAccounts(
    parseQQConfig({ accounts: [{ id: "official", provider: "official", official: {} }] }).accounts,
    { QQ_BOT_APP_ID: "app", QQ_BOT_APP_SECRET: "secret" },
  );
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = createOfficialApp({
    account,
    client,
    logger,
    storage: { rootDir },
    now: () => currentTime,
    connectTimeoutMs: 5,
  });
  const messages: IncomingMessage[] = [];
  app.onMessage((message: IncomingMessage) => {
    messages.push(message);
  });
  await app.start();
  try {
    const emit = (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    };
    emit("connected");
    emit("message", officialIncoming());
    expect(messages).toHaveLength(1);
    await app.replyMessage(messages[0]!, { text: "ok" });
    expect(sent).toEqual(["group:GROUP:msg-1"]);
    await expect(
      app.replyMessage({ ...messages[0]!, accountId: "other" }, { text: "wrong" }),
    ).rejects.toThrow("账号不匹配");
    expect(sent).toHaveLength(1);

    for (let index = 0; index < 4; index += 1) {
      await app.replyMessage(messages[0]!, { text: "ok" });
    }
    await expect(app.replyMessage(messages[0]!, { text: "too-many" })).rejects.toThrow(
      "次数已达上限",
    );
    expect(sent).toEqual(Array(5).fill("group:GROUP:msg-1"));

    currentTime += 60 * 60_000 + 1;
    emit(
      "message",
      officialIncoming({
        id: "msg-2",
        kind: "private",
        eventType: "C2C_MESSAGE_CREATE",
        replyTarget: { scope: "c2c", targetId: "USER", msgId: "msg-2" },
      }),
    );
    const expired = messages.at(-1)!;
    currentTime += 60 * 60_000 + 1;
    await expect(app.replyMessage(expired, { text: "expired" })).rejects.toThrow("超过有效期");
    expect(sent).toEqual(Array(5).fill("group:GROUP:msg-1"));
    expect(sent).not.toContain("proactive-group");
    expect(sent).not.toContain("proactive-private");
  } finally {
    await app.stop();
  }
});
