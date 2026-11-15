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
  sendBridgeTyping,
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
  const sent: unknown[] = [];
  const typingCalls: number[] = [];
  return {
    calls,
    sent,
    typingCalls,
    async replyMessage(_message: unknown, outgoing: unknown) {
      calls.push("reply");
      sent.push(outgoing);
      if (behavior.replyFails) throw new Error("被动回复窗口已过期");
    },
    async sendMessage(_target: unknown, outgoing: unknown) {
      calls.push("send");
      sent.push(outgoing);
      if (behavior.sendFails) throw new Error("主动发送被平台拒绝");
    },
    async sendTyping(_target: unknown, seconds: number) {
      typingCalls.push(seconds);
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
    latestGroupInboundSeq: 0,
    latestGroupId: null,
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
    latestGroupInboundSeq: 0,
    latestGroupId: null,
  });

  // 等待期间来新入站：不等超时，立刻带着新 seq 返回。
  const waiting = getBridgeStatus(bridgeDeps, ACCOUNT_ID, { since: 1, wait: 30 });
  setTimeout(() => store.recordInbound(privateMessage("OPENID_A", "第二条")), 50);
  await expect(waiting).resolves.toEqual({
    bound: true,
    latestInboundSeq: 2,
    latestGroupInboundSeq: 0,
    latestGroupId: null,
  });

  // 超时仍无新入站：返回当前值，不报错。
  const startedAt = Date.now();
  await expect(getBridgeStatus(bridgeDeps, ACCOUNT_ID, { since: 2, wait: 1 })).resolves.toEqual({
    bound: true,
    latestInboundSeq: 2,
    latestGroupInboundSeq: 0,
    latestGroupId: null,
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

test("control：富媒体发送（Markdown / 图片带说明）与输入中状态", async () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  store.addCandidate(privateMessage("OPENID_A", "你好"));
  store.bindOwner("OPENID_A");
  store.recordInbound(privateMessage("OPENID_A", "在吗"));
  const app = fakeApp();
  const bridgeDeps = deps(store, app);

  const markdown = await sendBridgeMessage(bridgeDeps, {
    accountId: ACCOUNT_ID,
    markdown: "# 标题\n**重点**",
  });
  expect(app.sent.at(-1)).toEqual({ text: "", markdown: "# 标题\n**重点**" });
  expect(markdown.record.kind).toBe("markdown");
  expect(markdown.via).toBe("reply");

  const image = await sendBridgeMessage(bridgeDeps, {
    accountId: ACCOUNT_ID,
    text: "看这张",
    image: "https://example.com/a.png",
  });
  expect(app.sent.at(-1)).toEqual({ text: "看这张", image: "https://example.com/a.png" });
  expect(image.record.kind).toBe("image");
  expect(image.record.text).toBe("看这张");

  // markdown 与 image / text 互斥，三者皆空也拒绝。
  await expect(
    sendBridgeMessage(bridgeDeps, {
      accountId: ACCOUNT_ID,
      markdown: "# x",
      image: "https://example.com/a.png",
    }),
  ).rejects.toBeInstanceOf(BotControlError);
  await expect(sendBridgeMessage(bridgeDeps, { accountId: ACCOUNT_ID })).rejects.toBeInstanceOf(
    BotControlError,
  );

  await expect(sendBridgeTyping(bridgeDeps, { accountId: ACCOUNT_ID })).resolves.toEqual({
    typing: true,
    seconds: 10,
  });
  expect(app.typingCalls).toEqual([10]);

  // 未绑定时 typing 拒绝。
  const unboundStore = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  await expect(
    sendBridgeTyping(deps(unboundStore, fakeApp()), { accountId: ACCOUNT_ID }),
  ).rejects.toBeInstanceOf(BotControlError);
});

test("control：语音独立发送，与文本同时提供时拒绝", async () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  store.addCandidate(privateMessage("OPENID_A", "你好"));
  store.bindOwner("OPENID_A");
  store.recordInbound(privateMessage("OPENID_A", "在吗"));
  const app = fakeApp();
  const bridgeDeps = deps(store, app);

  const voice = await sendBridgeMessage(bridgeDeps, {
    accountId: ACCOUNT_ID,
    voice: "base64://AAAA",
  });
  expect(app.sent.at(-1)).toEqual({ text: "", voice: "base64://AAAA" });
  expect(voice.record.kind).toBe("voice");
  expect(voice.record.text).toBe("[语音]");

  await expect(
    sendBridgeMessage(bridgeDeps, {
      accountId: ACCOUNT_ID,
      voice: "base64://AAAA",
      text: "听这个",
    }),
  ).rejects.toBeInstanceOf(BotControlError);
});

function groupMessage(groupId: string, senderId: string, text: string): IncomingMessage {
  return {
    id: `gmsg-${groupId}-${text}`,
    accountId: ACCOUNT_ID,
    platform: "official",
    scene: "group",
    conversationId: groupId,
    senderId,
    senderName: "群友",
    text,
    timestamp: 1_700_000_000_000,
    isAtBot: true,
    replyContext: {
      platform: "official",
      messageId: "gm-1",
      scene: "group",
      groupOpenId: groupId,
      userOpenId: senderId,
    },
  };
}

test("store：群记录与私聊严格分开（独立文件与 seq）", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const rootDir = tempRoot();
  const store = new BridgeStore({ rootDir, accountId: ACCOUNT_ID });
  store.recordInbound(privateMessage("OPENID_A", "私聊内容"));
  const groupRecord = store.recordGroupInbound(
    groupMessage("GROUP_1", "MEMBER_1", "群里 @ 机器人"),
  );

  expect(groupRecord.seq).toBe(1); // 群 seq 独立从 1 开始，不占用私聊 seq
  expect(store.latestInboundSeq()).toBe(1);
  expect(store.latestGroupInbound()).toEqual({ seq: 1, groupId: "GROUP_1" });
  expect(store.groupMessagesAfter("GROUP_1", 0).map((r) => r.text)).toEqual(["群里 @ 机器人"]);
  expect(store.messagesAfter(0).map((r) => r.text)).toEqual(["私聊内容"]);
  expect(store.listGroups()).toHaveLength(1);

  // 物理分离：私聊文件不含群内容，群文件不含私聊内容。
  const privateRaw = readFileSync(store.filePath, "utf8");
  const groupRaw = readFileSync(store.groupFilePath, "utf8");
  expect(privateRaw).not.toContain("群里 @ 机器人");
  expect(groupRaw).not.toContain("私聊内容");
  expect(existsSync(store.groupFilePath)).toBe(true);
});

test("control：群发送先走被动回复，未知群拒绝，状态带群 seq", async () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  const targets: unknown[] = [];
  const app = {
    async replyMessage(_message: unknown, _outgoing: unknown) {},
    async sendMessage(target: unknown, _outgoing: unknown) {
      targets.push(target);
    },
    async sendTyping() {},
  };
  const bridgeDeps: BridgeDeps = {
    bridges: new Map([[ACCOUNT_ID, { app: app as never, store }]]),
    logger: logger(),
  };

  await expect(
    sendBridgeMessage(bridgeDeps, { accountId: ACCOUNT_ID, groupId: "GROUP_X", text: "大家好" }),
  ).rejects.toBeInstanceOf(BotControlError);

  store.recordGroupInbound(groupMessage("GROUP_1", "MEMBER_1", "@机器人 在吗"));
  const sent = await sendBridgeMessage(bridgeDeps, {
    accountId: ACCOUNT_ID,
    groupId: "GROUP_1",
    text: "在的",
  });
  expect(sent.via).toBe("reply");
  expect(sent.record.text).toBe("在的");

  const status = await getBridgeStatus(bridgeDeps, ACCOUNT_ID, {});
  expect(status.latestGroupInboundSeq).toBe(1);
  expect(status.latestGroupId).toBe("GROUP_1");
  expect(status.latestInboundSeq).toBe(0);

  const groupView = getBridgeMessages(bridgeDeps, ACCOUNT_ID, 0, "GROUP_1");
  expect(groupView.messages.map((r) => `${r.direction}:${r.text}`)).toEqual([
    "in:@机器人 在吗",
    "out:在的",
  ]);
  expect(groupView.groups).toHaveLength(1);
  expect(targets).toHaveLength(0);
});

test("control：群内主人标识绑定后，messages 带 ownerSenderId；未出现过的发送者拒绝绑定", async () => {
  const store = new BridgeStore({ rootDir: tempRoot(), accountId: ACCOUNT_ID });
  store.recordGroupInbound(groupMessage("GROUP_1", "MEMBER_9", "@机器人 你好"));
  const app = fakeApp();
  const bridgeDeps = deps(store, app);

  expect(() =>
    bindBridgeOwner(bridgeDeps, { accountId: ACCOUNT_ID, groupId: "GROUP_1", senderId: "NOBODY" }),
  ).toThrow(BotControlError);

  const bound = bindBridgeOwner(bridgeDeps, {
    accountId: ACCOUNT_ID,
    groupId: "GROUP_1",
    senderId: "MEMBER_9",
  });
  expect(bound).toEqual({ bound: true, groupId: "GROUP_1", ownerSenderId: "MEMBER_9" });
  expect(store.groupOwnerSender("GROUP_1")).toBe("MEMBER_9");

  const groupView = getBridgeMessages(bridgeDeps, ACCOUNT_ID, 0, "GROUP_1");
  expect(groupView.ownerSenderId).toBe("MEMBER_9");
  expect(groupView.messages[0]?.atBot).toBe(true);
});
