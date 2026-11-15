import { expect, test, vi } from "vite-plus/test";
import { QQClient } from "../src/client.ts";
import type { QQIncomingMessage } from "../src/types.ts";

const { SDK, instances } = vi.hoisted(() => {
  const instances: any[] = [];
  class SDK {
    handlers = new Map<string, ((...args: any[]) => void)[]>();
    sent: unknown[] = [];
    options: Record<string, unknown>;
    run = new Promise<void>(() => {});
    constructor(options: Record<string, unknown>) {
      this.options = options;
      instances.push(this);
    }
    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    start() {
      return this.run;
    }
    stop() {}
    async sendText(target: unknown, text: string) {
      this.sent.push({ target, text });
      return { id: "sent", timestamp: 1 };
    }
    async sendImage(target: unknown, source: unknown, opts?: unknown) {
      this.sent.push({ target, source, opts });
      return { message: { id: "sent", timestamp: 1 } };
    }
    async sendMarkdown(target: unknown, content: string) {
      this.sent.push({ target, markdown: content });
      return { id: "sent", timestamp: 1 };
    }
    async sendVoice(target: unknown, source: unknown) {
      this.sent.push({ target, voice: source });
      return { message: { id: "sent", timestamp: 1 } };
    }
    async sendTyping(target: unknown, seconds?: number) {
      this.sent.push({ target, typing: seconds });
      return {};
    }
  }
  return { SDK, instances };
});
vi.mock("@tencent-connect/qqbot-nodejs", () => ({ QQBot: SDK }));

function inbound(kind: "group" | "c2c"): any {
  return {
    rawEventType: kind === "group" ? "GROUP_MESSAGE_CREATE" : "C2C_MESSAGE_CREATE",
    kind,
    messageId: "msg-1",
    content: kind === "group" ? "<@BOT_OPENID> /status" : "/status",
    senderId: "user",
    senderName: "User",
    ...(kind === "group" ? { groupOpenid: "GROUP", senderIsBot: false } : {}),
    replyTarget: {
      scope: kind === "group" ? "group" : "c2c",
      targetId: kind === "group" ? "GROUP" : "user",
      msgId: "msg-1",
    },
    raw: { event_id: "event-1" },
  };
}

test("normalizes C2C and group messages, preserves group discovery and skips bots", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret" });
  const sdk = instances.at(-1)!;
  const messages: QQIncomingMessage[] = [];
  const groups: unknown[] = [];
  client.on("message", (message) => {
    messages.push(message);
  });
  client.on("groupDiscovered", (group) => {
    groups.push(group);
  });
  void client.start();
  sdk.emit("message", {}, inbound("c2c"));
  sdk.emit("message", {}, inbound("group"));
  sdk.emit("message", {}, { ...inbound("group"), messageId: "bot", senderIsBot: true });
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({
    eventType: "C2C_MESSAGE_CREATE",
    kind: "private",
    replyTarget: { scope: "c2c", targetId: "user", msgId: "msg-1" },
    eventId: "event-1",
  });
  expect(messages[1]).toMatchObject({
    eventType: "GROUP_MESSAGE_CREATE",
    kind: "group",
    groupOpenid: "GROUP",
    content: "/status",
    isAtBot: false,
  });
  expect(groups).toEqual([{ openid: "GROUP", source: "message" }]);
});

test("passive reply uses the original msg_id", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret" });
  const sdk = instances.at(-1)!;
  const message: QQIncomingMessage = {
    id: "msg-1",
    kind: "group",
    content: "/status",
    senderId: "user",
    isAtBot: true,
    replyTarget: { scope: "group", targetId: "GROUP", msgId: "msg-1" },
  };
  await client.replyMessage(message, [{ type: "text", text: "ok" }]);
  expect(sdk.sent).toEqual([
    { target: { scope: "group", targetId: "GROUP", msgId: "msg-1" }, text: "ok" },
  ]);
});

test("C2C 富媒体：图片带说明走 sendImage，Markdown 走 sendMarkdown，互斥时报错", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret" });
  const sdk = instances.at(-1)!;

  await client.sendPrivateMessage("user", [
    { type: "text", text: "看图" },
    { type: "image", source: "https://example.com/a.png" },
  ]);
  expect(sdk.sent.at(-1)).toEqual({
    target: { scope: "c2c", targetId: "user" },
    source: { url: "https://example.com/a.png" },
    opts: { content: "看图" },
  });

  await client.sendPrivateMessage("user", [{ type: "markdown", content: "# 你好" }]);
  expect(sdk.sent.at(-1)).toEqual({
    target: { scope: "c2c", targetId: "user" },
    markdown: "# 你好",
  });

  await expect(
    client.sendPrivateMessage("user", [
      { type: "markdown", content: "# x" },
      { type: "image", source: "https://example.com/a.png" },
    ]),
  ).rejects.toThrow("不能与文本或图片合并");

  await client.sendTyping("user", 15);
  expect(sdk.sent.at(-1)).toEqual({ target: { scope: "c2c", targetId: "user" }, typing: 15 });
});

test("被动回复也可以发图片（带 msg_id 的 replyTarget）", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret" });
  const sdk = instances.at(-1)!;
  const message: QQIncomingMessage = {
    id: "msg-1",
    kind: "private",
    content: "在吗",
    senderId: "user",
    isAtBot: false,
    replyTarget: { scope: "c2c", targetId: "user", msgId: "msg-1" },
  };
  await client.replyMessage(message, [{ type: "image", source: "https://example.com/b.png" }]);
  expect(sdk.sent.at(-1)).toEqual({
    target: { scope: "c2c", targetId: "user", msgId: "msg-1" },
    source: { url: "https://example.com/b.png" },
    opts: { content: "" },
  });
});

test("C2C 语音：独立走 sendVoice，与文本合并时报错", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret" });
  const sdk = instances.at(-1)!;

  await client.sendPrivateMessage("user", [{ type: "voice", source: "https://example.com/a.wav" }]);
  expect(sdk.sent.at(-1)).toEqual({
    target: { scope: "c2c", targetId: "user" },
    voice: { url: "https://example.com/a.wav" },
  });

  await expect(
    client.sendPrivateMessage("user", [
      { type: "text", text: "听这个" },
      { type: "voice", source: "https://example.com/a.wav" },
    ]),
  ).rejects.toThrow("语音消息不能与文本");
});
