import { expect, test } from "vite-plus/test";
import type { Notifier } from "@nana/notify";
import type { OfflineAlert, OfflineState, OfflineStateStore } from "@nana/offline-detector";
import { offlineDetectorFeature } from "../src/offline/index.ts";
import { consoleLogger } from "../src/core/logger.ts";

type Handler = (context: never) => unknown;

interface Harness {
  emit(event: string, payload?: unknown): Promise<void>;
  sent: string[];
  recorded: string[];
  cleanup(): Promise<void>;
}

async function createHarness(recoveryFallbackMs = 30): Promise<Harness> {
  const handlers = new Map<string, Handler[]>();
  const sent: string[] = [];
  const recorded: string[] = [];
  let state: OfflineState | undefined;

  const store: OfflineStateStore = {
    read: () => state,
    write: (next) => {
      state = next;
    },
  };
  const notifier: Notifier = {
    async send(message) {
      sent.push(message.subject);
    },
  };

  const cleanup = (await offlineDetectorFeature.setup(
    {
      ws: {},
      adminGroupId: undefined,
      logger: consoleLogger,
      on(event: string, handler: Handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return () => {};
      },
      onCleanup() {},
      async sendAdminText() {},
      async sendAdminMsg() {},
      async sendGroupMsg() {
        return "";
      },
    } as never,
    {
      notifier,
      confirmCount: 3,
      store,
      recoveryFallbackMs,
      recordAlert: (alert: OfflineAlert) => {
        recorded.push(alert.kind);
      },
    },
  )) as (() => Promise<void>) | undefined;

  return {
    async emit(event, payload = {}) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload as never);
      }
    },
    sent,
    recorded,
    async cleanup() {
      await cleanup?.();
    },
  };
}

const OFFLINE = { status: { online: false } };
const ONLINE = { status: { online: true } };
const SOCKET_CLOSE = {
  code: 1006,
  reason: "",
  reconnection: { enable: true, attempts: Number.POSITIVE_INFINITY, delay: 5_000, nowAttempts: 3 },
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("QQ 仍离线时，WS 重连不会发出假的恢复邮件", async () => {
  const harness = await createHarness();

  for (let index = 0; index < 3; index += 1) {
    await harness.emit("meta_event.heartbeat", OFFLINE);
  }
  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);

  // WS 抖动重连，但 QQ 还没回来。
  await harness.emit("socket.open");
  await harness.emit("meta_event.heartbeat", OFFLINE);
  await wait(80);

  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);
  await harness.cleanup();
});

test("QQ 真的回来了才发恢复邮件", async () => {
  const harness = await createHarness();

  for (let index = 0; index < 3; index += 1) {
    await harness.emit("meta_event.heartbeat", OFFLINE);
  }

  await harness.emit("socket.open");
  await harness.emit("meta_event.heartbeat", ONLINE);

  expect(harness.sent).toEqual(["「NanaBot」离线通知", "「NanaBot」恢复通知"]);
  expect(harness.recorded).toEqual(["offline", "recovered"]);
  await harness.cleanup();
});

test("连接层断开且长时间没有心跳时，重连后由兜底计时器判恢复", async () => {
  const harness = await createHarness();

  await harness.emit("socket.close", SOCKET_CLOSE);
  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);

  await harness.emit("socket.open");
  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);

  await wait(80);
  expect(harness.sent).toEqual(["「NanaBot」离线通知", "「NanaBot」恢复通知"]);
  await harness.cleanup();
});

test("清理时取消未触发的心跳兜底计时器", async () => {
  const harness = await createHarness();

  await harness.emit("socket.close", SOCKET_CLOSE);
  await harness.emit("socket.open");
  await harness.cleanup();
  await wait(80);

  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);
});
