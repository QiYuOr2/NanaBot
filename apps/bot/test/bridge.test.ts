import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  BOT_CONTROL_BRIDGE_BIND_PATH,
  BOT_CONTROL_BRIDGE_MESSAGES_PATH,
  BOT_CONTROL_BRIDGE_SEND_PATH,
  BOT_CONTROL_BRIDGE_STATUS_PATH,
} from "@nana/constants";
import { BridgeStore } from "../src/bridge/index.ts";
import {
  bindBridgeOwner,
  BotControlError,
  getBridgeMessages,
  getBridgeStatus,
  sendBridgeMessage,
  startBotControlServer,
  type BridgeDeps,
} from "../src/control/index.ts";
import type { IncomingMessage } from "../src/message/types.ts";
import type { Logger } from "../src/core/logger.ts";

const ACCOUNT_ID = "777001";
const BRIDGE_TOKEN = "bridge-test-token-123456";
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-bridge-"));
  roots.push(rootDir);
  return rootDir;
}

function logger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function privateMessage(senderId: string, text: string): IncomingMessage {
  return {
    id: `msg-${senderId}-${text}`,
    accountId: ACCOUNT_ID,
    platform: "official",
    scene: "private",
    conversationId: senderId,
    senderId,
    senderName: "七宇",
    text,
    timestamp: 1_700_000_000_000,
    isAtBot: false,
    replyContext: {
      platform: "official",
      messageId: "m-1",
      scene: "private",
      userOpenId: senderId,
    },
  };
}

function fakeApp(behavior: { replyFails?: boolean; sendFails?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    async replyMessage() {
      calls.push("reply");
      if (behavior.replyFails) throw new Error("被动回复窗口已过期");
    },
    async sendMessage() {
      calls.push("send");
      if (behavior.sendFails) throw new Error("主动发送被平台拒绝");
    },
  };
}

function deps(store: BridgeStore, app = fakeApp()): BridgeDeps {
  return { bridges: new Map([[ACCOUNT_ID, { app, store }]]), logger: logger() };
}

test("store：候选记录、绑定校验与消息 seq", () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  expect(store.latestInboundSeq()).toBe(0);

  // 候选之外的发送者拒绝绑定。
  expect(() => store.bindOwner("UNKNOWN")).toThrow("不在候选列表");

  store.addCandidate(privateMessage("OPENID_A", "你好"));
  store.addCandidate(privateMessage("OPENID_A", "是我"));
  const state = store.bindOwner("OPENID_A");
  expect(state.ownerId).toBe("OPENID_A");
  // 绑定时候选被清空，其消息提升为最近入站上下文。
  expect(store.read().candidates).toEqual([]);
  expect(store.read().lastInbound?.text).toBe("是我");

  const inbound = store.recordInbound(privateMessage("OPENID_A", "在吗"));
  const outbound = store.recordOutbound("在的", "reply");
  expect(inbound.seq).toBe(1);
  expect(outbound.seq).toBe(2);
  expect(store.latestInboundSeq()).toBe(1);
  expect(store.messagesAfter(1).map((record) => record.seq)).toEqual([2]);
});

test("control：未绑定时返回候选，绑定后状态与发送走被动回复", async () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  store.addCandidate(privateMessage("OPENID_A", "你好"));
  const app = fakeApp();
  const bridgeDeps = deps(store, app);

  await expect(getBridgeStatus(bridgeDeps, ACCOUNT_ID)).resolves.toEqual({
    bound: false,
    latestInboundSeq: 0,
  });
  const before = getBridgeMessages(bridgeDeps, ACCOUNT_ID, 0);
  expect(before.bound).toBe(false);
  expect(before.candidates.map((candidate) => candidate.senderId)).toEqual(["OPENID_A"]);

  // 未绑定时发送被拒。
  await expect(
    sendBridgeMessage(bridgeDeps, { accountId: ACCOUNT_ID, text: "hi" }),
  ).rejects.toBeInstanceOf(BotControlError);

  expect(bindBridgeOwner(bridgeDeps, { accountId: ACCOUNT_ID, senderId: "OPENID_A" })).toEqual({
    bound: true,
    ownerId: "OPENID_A",
  });
  const sent = await sendBridgeMessage(bridgeDeps, { accountId: ACCOUNT_ID, text: "收到" });
  expect(sent.via).toBe("reply");
  expect(app.calls).toEqual(["reply"]);
  expect((await getBridgeStatus(bridgeDeps, ACCOUNT_ID)).bound).toBe(true);
});

test("status 长轮询：已越过 since 立即返回，等待中新入站立刻唤醒，超时返回当前值", async () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  store.addCandidate(privateMessage("OPENID_A", "你好"));
  store.bindOwner("OPENID_A");
  store.recordInbound(privateMessage("OPENID_A", "第一条"));
  const bridgeDeps = deps(store, fakeApp());

  // since 已被越过：即使带 wait 也立即返回。
  await expect(getBridgeStatus(bridgeDeps, ACCOUNT_ID, { since: 0, wait: 30 })).resolves.toEqual({
    bound: true,
    latestInboundSeq: 1,
  });

  // 等待期间来新入站：不等超时，立刻带着新 seq 返回。
  const waiting = getBridgeStatus(bridgeDeps, ACCOUNT_ID, { since: 1, wait: 30 });
  setTimeout(() => store.recordInbound(privateMessage("OPENID_A", "第二条")), 50);
  await expect(waiting).resolves.toEqual({ bound: true, latestInboundSeq: 2 });

  // 超时仍无新入站：返回当前值，不报错。
  const startedAt = Date.now();
  await expect(getBridgeStatus(bridgeDeps, ACCOUNT_ID, { since: 2, wait: 1 })).resolves.toEqual({
    bound: true,
    latestInboundSeq: 2,
  });
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);

  // wait 超过上限（55）拒绝。
  await expect(
    getBridgeStatus(bridgeDeps, ACCOUNT_ID, { since: 0, wait: 99 }),
  ).rejects.toBeInstanceOf(BotControlError);
});

test("control：被动回复失败时回退主动发送，两次都失败则记录并报错", async () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  store.addCandidate(privateMessage("OPENID_A", "你好"));
  store.bindOwner("OPENID_A");

  const fallbackApp = fakeApp({ replyFails: true });
  const sent = await sendBridgeMessage(deps(store, fallbackApp), {
    accountId: ACCOUNT_ID,
    text: "回退发送",
  });
  expect(sent.via).toBe("proactive");
  expect(fallbackApp.calls).toEqual(["reply", "send"]);

  const failingApp = fakeApp({ replyFails: true, sendFails: true });
  await expect(
    sendBridgeMessage(deps(store, failingApp), { accountId: ACCOUNT_ID, text: "发不出" }),
  ).rejects.toMatchObject({ statusCode: 502 });
  const records = store.messagesAfter(0);
  expect(records.at(-1)).toMatchObject({
    direction: "out",
    text: "发不出",
    error: "主动发送被平台拒绝",
  });
});

test("HTTP：status 公开，messages/send/bind 只认桥接口令或管理口令", async () => {
  const rootDir = tempRoot();
  const store = new BridgeStore({ rootDir, accountId: ACCOUNT_ID });
  store.addCandidate(privateMessage("OPENID_A", "你好"));
  vi.stubEnv("NANA_BRIDGE_TOKEN", BRIDGE_TOKEN);
  const server = await startBotControlServer({
    runtimes: new Map(),
    bridges: new Map([[ACCOUNT_ID, { app: fakeApp(), store }]]),
    rootDir,
    logger: logger(),
    port: 0,
  });
  try {
    const status = await fetch(
      `${server.url}${BOT_CONTROL_BRIDGE_STATUS_PATH}?account=${ACCOUNT_ID}`,
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ ok: true, bound: false });

    const denied = await fetch(
      `${server.url}${BOT_CONTROL_BRIDGE_MESSAGES_PATH}?account=${ACCOUNT_ID}`,
    );
    expect(denied.status).toBe(401);

    const messages = await fetch(
      `${server.url}${BOT_CONTROL_BRIDGE_MESSAGES_PATH}?account=${ACCOUNT_ID}&after=0`,
      { headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` } },
    );
    expect(messages.status).toBe(200);
    await expect(messages.json()).resolves.toMatchObject({
      ok: true,
      candidates: [{ senderId: "OPENID_A" }],
    });

    const bind = await fetch(`${server.url}${BOT_CONTROL_BRIDGE_BIND_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: ACCOUNT_ID, senderId: "OPENID_A" }),
    });
    expect(bind.status).toBe(200);

    const send = await fetch(`${server.url}${BOT_CONTROL_BRIDGE_SEND_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: ACCOUNT_ID, text: "你好，我是レイ" }),
    });
    expect(send.status).toBe(200);
    await expect(send.json()).resolves.toMatchObject({ ok: true, via: "reply" });
  } finally {
    await server.stop();
  }
});
