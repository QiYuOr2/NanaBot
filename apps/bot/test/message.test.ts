import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { NapcatIncomingEvent } from "@nana/napcat";
import type { QQIncomingMessage } from "@nana/qq";
import { readPushLogs, writeLiveStatus } from "@nana/storage";
import { parseQQConfig } from "@nana/config";
import { mergeMessageConfig } from "../src/message/config.ts";
import {
  builtInCommands,
  createMessageFeature,
  getCommand,
  listCommands,
  matchMessageRules,
  parseCommand,
  registerCommand,
} from "../src/message/engine.ts";
import { normalizeNapcatMessage, normalizeOfficialMessage } from "../src/message/platform.ts";
import type { FeatureContext } from "../src/core/feature.ts";
import type { IncomingMessage, MessageReplyContext, MessageRuntime } from "../src/message/types.ts";

const temporaryRoots: string[] = [];
const napcatReplyContext: MessageReplyContext = {
  platform: "napcat",
  messageId: "id",
  userId: "user",
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: "message-1",
    accountId: "account",
    platform: "napcat",
    scene: "private",
    conversationId: "user",
    senderId: "user",
    text: "hello",
    isAtBot: false,
    replyContext: napcatReplyContext,
    ...overrides,
  };
}

function runtime(rootDir: string, roomIds: number[] = []): MessageRuntime {
  return {
    accountId: "account",
    accountName: "测试账号",
    provider: "napcat",
    connected: () => true,
    configuredStreamers: roomIds.length,
    configuredAccounts: 2,
    connectedAccounts: () => 1,
    startedAt: Date.now() - 60_000,
    rootDir,
    roomIds,
  };
}

function harness(config: unknown, rootDir: string, accountConfig?: unknown) {
  const replies: string[] = [];
  let handler: ((message: IncomingMessage) => void | Promise<void>) | undefined;
  const context = {
    accountId: "account",
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    onCleanup() {},
    onConnectionState() {
      return () => {};
    },
    onHeartbeat() {
      return () => {};
    },
    onMessage(next: (message: IncomingMessage) => void | Promise<void>) {
      handler = next;
      return () => {
        handler = undefined;
      };
    },
    async replyMessage(_message: IncomingMessage, response: { text: string }) {
      replies.push(response.text);
    },
    async sendMessage(_target: unknown, response: { text: string }) {
      replies.push(response.text);
    },
    async sendAdminText() {},
    async sendAdminMsg() {},
    async sendGroupMsg() {
      return "";
    },
  } satisfies FeatureContext;
  createMessageFeature().setup(context, {
    config,
    accountConfig,
    runtime: runtime(rootDir),
    logger: context.logger,
  });
  return { replies, send: async (message: IncomingMessage) => handler?.(message) };
}

describe("message platform models", () => {
  test("normalizes NapCat group and private events", () => {
    const event: NapcatIncomingEvent = {
      messageId: "42",
      messageType: "group",
      groupId: "456",
      userId: "123",
      senderName: "A",
      text: "hi",
      timestamp: 100,
      isAtBot: true,
    };
    expect(normalizeNapcatMessage(event, "account-a")).toMatchObject({
      id: "42",
      accountId: "account-a",
      scene: "group",
      conversationId: "456",
      senderId: "123",
      text: "hi",
      isAtBot: true,
      replyContext: { platform: "napcat", messageId: "42", groupId: "456" },
    });
    expect(normalizeNapcatMessage({ ...event, text: "" }, "account-a")).toBeUndefined();
  });

  test("normalizes official group and C2C reply contexts without mixing openids", () => {
    const base: QQIncomingMessage = {
      id: "msg",
      kind: "group",
      eventType: "GROUP_MESSAGE_CREATE",
      content: "/status",
      senderId: "sender",
      groupOpenid: "GROUP",
      isAtBot: true,
      replyTarget: { scope: "group", targetId: "GROUP", msgId: "msg" },
    };
    expect(normalizeOfficialMessage(base, "official")).toMatchObject({
      scene: "group",
      conversationId: "GROUP",
      replyContext: {
        platform: "official",
        scene: "group",
        groupOpenId: "GROUP",
        messageId: "msg",
        eventType: "GROUP_MESSAGE_CREATE",
      },
    });
    expect(
      normalizeOfficialMessage(
        {
          ...base,
          kind: "private",
          eventType: "C2C_MESSAGE_CREATE",
          replyTarget: { scope: "c2c", targetId: "USER", msgId: "msg" },
        },
        "official",
      ),
    ).toMatchObject({
      scene: "private",
      conversationId: "USER",
      replyContext: { platform: "official", scene: "private", userOpenId: "USER" },
    });
  });
});

describe("configuration", () => {
  test("merges global defaults with account overrides", () => {
    const config = mergeMessageConfig(
      {
        commands: { prefix: "!" },
        cooldown: { enabled: true, commandUserMs: 1000 },
        scopes: { group: { enabled: true }, private: { enabled: true } },
      },
      { commands: { enabled: false }, scopes: { group: { deny: ["123"] } } },
    );
    expect(config.commands).toEqual({ enabled: false, prefix: "!", aliases: {} });
    expect(config.cooldown.commandUserMs).toBe(1000);
    expect(config.scopes.group.deny).toEqual(["123"]);
    expect(config.scopes.private.enabled).toBe(true);
  });

  test("validates duplicate IDs, regex syntax and account schema", () => {
    expect(() =>
      mergeMessageConfig({
        rules: {
          items: [
            { id: "a", type: "exact", pattern: "a", response: "x" },
            { id: "a", type: "exact", pattern: "b", response: "x" },
          ],
        },
      }),
    ).toThrow(/重复/);
    expect(() =>
      mergeMessageConfig({
        rules: { items: [{ id: "bad", type: "regex", pattern: "(", response: "x" }] },
      }),
    ).toThrow(/正则表达式无效/);
    expect(() =>
      parseQQConfig({
        accounts: [
          {
            id: "a",
            provider: "napcat",
            napcat: { wsUrl: "ws://localhost", accessToken: "x" },
            message: { commandAliases: { status: ["same"], help: ["same"] } },
          },
        ],
      }),
    ).toThrow(/别名.*same/);
  });
});

describe("dispatcher", () => {
  test("command registry supports aliases, case and complete names", () => {
    expect(parseCommand("/LIVE 544786")).toEqual({ name: "live", args: ["544786"] });
    expect(parseCommand("  /help status")).toEqual({ name: "help", args: ["status"] });
    expect(parseCommand("status")).toBeUndefined();
    expect(listCommands()).toEqual(builtInCommands);
    expect(getCommand("STATUS")?.permission).toBe("everyone");
  });

  test("unknown commands are reported and never fall through to rules", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "nana-message-"));
    temporaryRoots.push(rootDir);
    const result = harness(
      {
        cooldown: { enabled: false },
        rules: {
          enabled: true,
          items: [{ id: "any", type: "contains", pattern: "missing", response: "wrong" }],
        },
      },
      rootDir,
    );
    await result.send(incoming({ id: "unknown", text: "/missing" }));
    expect(result.replies).toEqual(["未知命令：missing"]);
  });

  test("matches all rule types using a linear-time regex engine", () => {
    const rules = [
      {
        id: "exact",
        enabled: true,
        type: "exact" as const,
        pattern: "HELLO",
        ignoreCase: true,
        response: "one",
      },
      {
        id: "contains",
        enabled: true,
        type: "contains" as const,
        pattern: "world",
        ignoreCase: true,
        response: "two",
      },
      {
        id: "starts",
        enabled: true,
        type: "startsWith" as const,
        pattern: "go",
        ignoreCase: false,
        response: "three",
      },
      {
        id: "regex",
        enabled: true,
        type: "regex" as const,
        pattern: "(a+)+$",
        ignoreCase: true,
        response: "four",
      },
    ];
    expect(matchMessageRules("hello world", rules)).toBe("two");
    expect(matchMessageRules("go now", rules)).toBe("three");
    expect(matchMessageRules("aaaa", rules)).toBe("four");
  });

  test("prioritizes commands, deduplicates and isolates accounts", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "nana-message-"));
    temporaryRoots.push(rootDir);
    const first = harness(
      {
        commandAliases: { status: ["state"] },
        rules: {
          enabled: true,
          items: [{ id: "status", type: "contains", pattern: "/status", response: "wrong" }],
        },
        cooldown: { enabled: false },
      },
      rootDir,
    );
    await first.send(incoming({ id: "same", text: "/state" }));
    await first.send(incoming({ id: "same", text: "/state" }));
    expect(first.replies).toHaveLength(1);
    expect(first.replies[0]).toContain("NanaBot：运行中");
    const second = harness({ cooldown: { enabled: false } }, rootDir);
    await second.send(incoming({ id: "same", accountId: "other", text: "/status" }));
    expect(second.replies).toHaveLength(1);
  });

  test("enforces permissions, scopes and cooldown", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "nana-message-"));
    temporaryRoots.push(rootDir);
    const unregister = registerCommand({
      name: "admin-only",
      description: "admin",
      permission: "admin",
      execute: async ({ reply }) => reply("ok"),
    });
    try {
      const result = harness(
        {
          admins: { users: ["admin"] },
          scopes: { private: { enabled: true, deny: ["blocked"] } },
          cooldown: { enabled: false },
        },
        rootDir,
      );
      await result.send(
        incoming({ id: "1", senderId: "blocked", conversationId: "blocked", text: "/admin-only" }),
      );
      await result.send(
        incoming({ id: "2", senderId: "guest", conversationId: "guest", text: "/admin-only" }),
      );
      await result.send(
        incoming({ id: "3", senderId: "admin", conversationId: "admin", text: "/admin-only" }),
      );
      expect(result.replies).toEqual(["你没有权限执行此命令。", "ok"]);
    } finally {
      unregister();
    }
  });

  test("queries real live status and records reply failures", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "nana-message-"));
    temporaryRoots.push(rootDir);
    writeLiveStatus(
      544786,
      {
        streamer: "主播",
        live: true,
        updatedAt: new Date().toISOString(),
        title: "直播中",
        area: null,
        viewer: null,
      },
      { rootDir },
    );
    const replies: string[] = [];
    const context = {
      accountId: "account",
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onCleanup() {},
      onConnectionState() {
        return () => {};
      },
      onHeartbeat() {
        return () => {};
      },
      onMessage(next: (message: IncomingMessage) => void | Promise<void>) {
        void next;
        return () => {};
      },
      async replyMessage(_message: IncomingMessage, response: { text: string }) {
        replies.push(response.text);
      },
      async sendMessage(_target: unknown, response: { text: string }) {
        replies.push(response.text);
      },
      async sendAdminText() {},
      async sendAdminMsg() {},
      async sendGroupMsg() {
        return "";
      },
    } satisfies FeatureContext;
    let handler: ((message: IncomingMessage) => void | Promise<void>) | undefined;
    context.onMessage = (next) => {
      handler = next;
      return () => {};
    };
    createMessageFeature().setup(context, {
      config: { cooldown: { enabled: false } },
      runtime: runtime(rootDir, [544786]),
      logger: context.logger,
    });
    await handler?.(incoming({ id: "live", text: "/live 544786" }));
    expect(replies[0]).toContain("主播（544786）：直播中");
  });

  test("keeps command prefix text out of auto-reply rules", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "nana-message-"));
    temporaryRoots.push(rootDir);
    const result = harness(
      {
        commands: { enabled: false },
        rules: {
          enabled: true,
          items: [{ id: "status", type: "contains", pattern: "/status", response: "wrong" }],
        },
      },
      rootDir,
    );
    await result.send(incoming({ id: "disabled", text: "/status" }));
    expect(result.replies).toEqual([]);
  });

  test("writes a structured push log on reply failure", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "nana-message-"));
    temporaryRoots.push(rootDir);
    let handler: ((message: IncomingMessage) => void | Promise<void>) | undefined;
    const context = {
      accountId: "account",
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onCleanup() {},
      onConnectionState() {
        return () => {};
      },
      onHeartbeat() {
        return () => {};
      },
      onMessage(next: (message: IncomingMessage) => void | Promise<void>) {
        handler = next;
        return () => {};
      },
      async sendMessage() {
        throw new Error("send failed");
      },
      async replyMessage() {
        throw new Error("unexpected passive reply");
      },
      async sendAdminText() {},
      async sendAdminMsg() {},
      async sendGroupMsg() {
        return "";
      },
    } satisfies FeatureContext;
    createMessageFeature().setup(context, {
      config: { cooldown: { enabled: false } },
      runtime: runtime(rootDir),
      logger: context.logger,
    });
    await handler?.(incoming({ id: "failed", text: "/status private-secret" }));
    const logs = readPushLogs({ rootDir });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      success: false,
      error: "send failed",
      purpose: "message.command",
    });
    expect(logs[0]?.content).not.toContain("private-secret");
  });

  test("official group replies use the passive path without adding an at mention", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "nana-message-"));
    temporaryRoots.push(rootDir);
    const passive: string[] = [];
    const proactive: string[] = [];
    let handler: ((message: IncomingMessage) => void | Promise<void>) | undefined;
    const context = {
      accountId: "official",
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onCleanup() {},
      onConnectionState: () => () => {},
      onHeartbeat: () => () => {},
      onMessage(next: (message: IncomingMessage) => void | Promise<void>) {
        handler = next;
        return () => {};
      },
      async replyMessage(_message: IncomingMessage, response: { text: string }) {
        passive.push(response.text);
      },
      async sendMessage(_target: unknown, response: { text: string }) {
        proactive.push(response.text);
      },
      async sendAdminText() {},
      async sendAdminMsg() {},
      async sendGroupMsg() {
        return "";
      },
    } satisfies FeatureContext;
    createMessageFeature().setup(context, {
      config: { cooldown: { enabled: false } },
      runtime: runtime(rootDir),
      logger: context.logger,
    });
    await handler?.(
      incoming({
        id: "group",
        accountId: "official",
        platform: "official",
        scene: "group",
        conversationId: "GROUP",
        text: "/status",
        replyContext: {
          platform: "official",
          messageId: "group",
          scene: "group",
          groupOpenId: "GROUP",
        },
      }),
    );
    expect(passive).toEqual([expect.stringContaining("NanaBot：运行中")]);
    expect(passive[0]).not.toContain("<@");
    expect(proactive).toEqual([]);
  });
});
