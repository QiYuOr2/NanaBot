import { expect, test, vi } from "vite-plus/test";

const sdk = vi.hoisted(() => {
  const instances: any[] = [];
  class NCWebsocket {
    subscriptions = new Map<string, ((event: any) => void)[]>();
    sent: unknown[] = [];
    stopped = false;
    constructor() {
      instances.push(this);
    }
    subscribe(event: string, handler: (context: any) => void) {
      const list = this.subscriptions.get(event) ?? [];
      list.push(handler);
      this.subscriptions.set(event, list);
      return () => {
        const current = this.subscriptions.get(event) ?? [];
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
      };
    }
    emit(event: string, context: unknown) {
      for (const handler of this.subscriptions.get(event) ?? []) handler(context);
    }
    async connect() {}
    async disconnect() {
      this.stopped = true;
    }
    async reconnect() {}
    async get_status() {
      return { online: true };
    }
    async send_group_msg(params: unknown) {
      this.sent.push(params);
      return { message_id: 1 };
    }
    async send_private_msg(params: unknown) {
      this.sent.push(params);
      return { message_id: 2 };
    }
    async get_group_info() {
      return { group_id: 123, group_name: "测试群" };
    }
  }
  return { NCWebsocket, instances };
});

vi.mock("node-napcat-ts", () => ({
  NCWebsocket: sdk.NCWebsocket,
  Structs: {
    text: (text: string) => ({ type: "text", data: { text } }),
    at: (qq: string) => ({ type: "at", data: { qq } }),
    image: (file: unknown) => ({ type: "image", data: { file } }),
    reply: (id: string) => ({ type: "reply", data: { id } }),
  },
}));

import { NapcatClient } from "../src/client.ts";
import type { NapcatIncomingEvent } from "../src/types.ts";

function groupEvent(overrides: Record<string, unknown> = {}) {
  return {
    self_id: 999,
    user_id: 123,
    time: 100,
    message_id: 42,
    message_type: "group",
    sender: { user_id: 123, nickname: "Alice", card: "A" },
    post_type: "message",
    group_id: 456,
    message_format: "array",
    message: [
      { type: "text", data: { text: "hello " } },
      { type: "image", data: { file: "x" } },
      { type: "at", data: { qq: "999" } },
      { type: "text", data: { text: "world" } },
    ],
    ...overrides,
  };
}

test("converts OneBot events, ignores self messages and sends plain group replies", async () => {
  const client = new NapcatClient({ url: "ws://localhost", accountId: "main" });
  const socket = sdk.instances.at(-1)!;
  const messages: NapcatIncomingEvent[] = [];
  client.onMessage((event) => {
    messages.push(event);
  });
  socket.emit("message", groupEvent());
  socket.emit("message", groupEvent({ user_id: 999 }));
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    messageId: "42",
    messageType: "group",
    groupId: "456",
    userId: "123",
    text: "hello world",
    isAtBot: true,
  });
  await client.reply(messages[0]!, [{ type: "text", text: "ok" }]);
  expect(socket.sent[0]).toMatchObject({
    group_id: 456,
    message: [{ type: "text", data: { text: "ok" } }],
  });
  await client.reply(
    {
      messageId: "43",
      messageType: "private",
      userId: "321",
      text: "hi",
      isAtBot: false,
    },
    [{ type: "text", text: "private-ok" }],
  );
  expect(socket.sent[1]).toMatchObject({
    user_id: 321,
    message: [{ type: "text", data: { text: "private-ok" } }],
  });
});

test("sends private messages, resolves group info, tracks state and cleans up", async () => {
  const client = new NapcatClient({ url: "ws://localhost", accountId: "main" });
  const socket = sdk.instances.at(-1)!;
  const states: string[] = [];
  const messages: NapcatIncomingEvent[] = [];
  client.onConnectionState((state) => states.push(state.phase ?? "unknown"));
  client.onMessage((event) => {
    messages.push(event);
  });
  socket.emit("socket.connecting", {});
  socket.emit("socket.open", {});
  socket.emit("socket.close", { code: 1006, reconnection: { nowAttempts: 3 } });
  expect(states).toEqual(["connecting", "connected", "disconnected"]);
  await client.sendPrivateMessage("123", [{ type: "text", text: "hi" }]);
  await client.sendPrivateMessage("123", [{ type: "text", text: "hi" }]);
  expect(socket.sent[0]).toMatchObject({
    user_id: 123,
    message: [{ type: "text", data: { text: "hi" } }],
  });
  expect(await client.getGroupInfo("123")).toEqual({ groupId: "123", groupName: "测试群" });
  await client.stop();
  expect(socket.stopped).toBe(true);
  socket.emit("message", groupEvent());
  expect(messages).toHaveLength(0);
});
