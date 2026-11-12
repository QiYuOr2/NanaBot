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
    async sendImage() {
      return { message: { id: "sent", timestamp: 1 } };
    }
  }
  return { SDK, instances };
});
vi.mock("@tencent-connect/qqbot-nodejs", () => ({ QQBot: SDK }));

function inbound(kind: "group" | "c2c"): any {
  return {
    rawEventType: kind === "group" ? "GROUP_AT_MESSAGE_CREATE" : "C2C_MESSAGE_CREATE",
    kind,
    messageId: "msg-1",
    content: "/status",
    senderId: "user",
    senderName: "User",
    ...(kind === "group"
      ? { groupOpenid: "GROUP", mentions: [{ is_you: true }], senderIsBot: false }
      : {}),
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
    eventType: "GROUP_AT_MESSAGE_CREATE",
    kind: "group",
    groupOpenid: "GROUP",
    isAtBot: true,
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
