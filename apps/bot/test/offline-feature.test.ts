import { expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Notifier } from "@nana/notify";
import type { OfflineAlert, OfflineState, OfflineStateStore } from "@nana/offline-detector";
import { offlineDetectorFeature } from "../src/offline/index.ts";
import { consoleLogger } from "../src/core/logger.ts";

type StateHandler = (state: never) => void;
type HeartbeatHandler = (online: boolean) => void;

interface Harness {
  emit(event: string, payload?: unknown): Promise<void>;
  sent: string[];
  messages: { subject: string; text: string }[];
  recorded: string[];
  cleanup(): Promise<void>;
}

async function createHarness(
  recoveryFallbackMs = 30,
  extra: { deploymentMarkerPath?: string } = {},
): Promise<Harness> {
  const stateHandlers: StateHandler[] = [];
  const heartbeatHandlers: HeartbeatHandler[] = [];
  const sent: string[] = [];
  const messages: { subject: string; text: string }[] = [];
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
      messages.push({ subject: message.subject, text: message.text });
    },
  };

  const cleanup = (await offlineDetectorFeature.setup(
    {
      accountId: "napcat",
      adminGroupId: undefined,
      logger: consoleLogger,
      onConnectionState(handler: StateHandler) {
        stateHandlers.push(handler);
        return () => {};
      },
      onHeartbeat(handler: HeartbeatHandler) {
        heartbeatHandlers.push(handler);
        return () => {};
      },
      onMessage: () => () => {},
      replyMessage: async () => {},
      sendMessage: async () => {},
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
      deploymentMarkerPath: extra.deploymentMarkerPath,
      recordAlert: (alert: OfflineAlert) => {
        recorded.push(alert.kind);
      },
    },
  )) as (() => Promise<void>) | undefined;

  return {
    async emit(event, payload = {}) {
      if (event === "meta_event.heartbeat") {
        const online = (payload as typeof OFFLINE).status.online;
        for (const handler of heartbeatHandlers) handler(online);
        return;
      }
      for (const handler of stateHandlers) handler(payload as never);
    },
    sent,
    messages,
    recorded,
    async cleanup() {
      await cleanup?.();
    },
  };
}

const OFFLINE = { status: { online: false } };
const ONLINE = { status: { online: true } };
const SOCKET_CLOSE = {
  connected: false,
  phase: "disconnected",
  platform: "napcat",
  reconnectAttempts: 3,
};
const SOCKET_OPEN = {
  connected: true,
  phase: "connected",
  platform: "napcat",
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("QQ 仍离线时，WS 重连不会发出假的恢复邮件", async () => {
  const harness = await createHarness();

  for (let index = 0; index < 3; index += 1) {
    await harness.emit("meta_event.heartbeat", OFFLINE);
  }
  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);

  // WS 抖动重连，但 QQ 还没回来。
  await harness.emit("socket.open", SOCKET_OPEN);
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

  await harness.emit("socket.open", SOCKET_OPEN);
  await harness.emit("meta_event.heartbeat", ONLINE);

  expect(harness.sent).toEqual(["「NanaBot」离线通知", "「NanaBot」恢复通知"]);
  expect(harness.recorded).toEqual(["offline", "recovered"]);
  await harness.cleanup();
});

test("连接层断开且长时间没有心跳时，重连后由兜底计时器判恢复", async () => {
  const harness = await createHarness();

  await harness.emit("socket.close", SOCKET_CLOSE);
  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);

  await harness.emit("socket.open", SOCKET_OPEN);
  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);

  await wait(80);
  expect(harness.sent).toEqual(["「NanaBot」离线通知", "「NanaBot」恢复通知"]);
  await harness.cleanup();
});

test("清理时取消未触发的心跳兜底计时器", async () => {
  const harness = await createHarness();

  await harness.emit("socket.close", SOCKET_CLOSE);
  await harness.emit("socket.open", SOCKET_OPEN);
  await harness.cleanup();
  await wait(80);

  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);
});

test("部署标记有效时，离线与恢复通知改用部署措辞", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nana-deploy-marker-"));
  const marker = join(dir, ".deploying.json");
  writeFileSync(marker, JSON.stringify({ startedAt: new Date().toISOString(), ref: "abc1234" }));
  const harness = await createHarness(30, { deploymentMarkerPath: marker });

  await harness.emit("socket.close", SOCKET_CLOSE);
  expect(harness.sent).toEqual(["「NanaBot」部署中通知"]);
  expect(harness.messages[0].text).toContain("计划内重启");
  expect(harness.messages[0].text).toContain("部署版本: abc1234");

  await harness.emit("socket.open", SOCKET_OPEN);
  await wait(80);
  expect(harness.sent).toEqual(["「NanaBot」部署中通知", "「NanaBot」部署完成通知"]);
  // 告警记录本身不改，站点告警页仍按离线/恢复展示。
  expect(harness.recorded).toEqual(["offline", "recovered"]);
  await harness.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

test("部署标记已过期时，离线通知维持故障措辞", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nana-deploy-marker-"));
  const marker = join(dir, ".deploying.json");
  writeFileSync(
    marker,
    JSON.stringify({ startedAt: new Date(Date.now() - 60 * 60_000).toISOString() }),
  );
  const harness = await createHarness(30, { deploymentMarkerPath: marker });

  await harness.emit("socket.close", SOCKET_CLOSE);
  expect(harness.sent).toEqual(["「NanaBot」离线通知"]);
  await harness.cleanup();
  rmSync(dir, { recursive: true, force: true });
});
