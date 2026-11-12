import { expect, test, vi } from "vite-plus/test";
import { QQClient } from "../src/client.ts";

const { SDK, instances } = vi.hoisted(() => {
  const instances: SDK[] = [];
  class SDK {
    options: Record<string, unknown>;
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    resolveRun!: () => void;
    rejectRun!: (error: Error) => void;
    run: Promise<void>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.run = new Promise((resolve, reject) => {
        this.resolveRun = resolve;
        this.rejectRun = reject;
      });
      instances.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    start() {
      return this.run;
    }
    stop() {
      this.resolveRun();
    }
  }
  return { SDK, instances };
});
vi.mock("@tencent-connect/qqbot-nodejs", () => ({ QQBot: SDK }));

test("规范化 READY/RESUMED、断连与群发现事件，支持取消订阅", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret", sandbox: true });
  const sdk = instances.at(-1)!;
  expect(sdk.options).toMatchObject({
    intents: 1 << 25,
    markdownSupport: false,
    baseUrl: "https://sandbox.api.sgroup.qq.com",
  });
  const connected = vi.fn();
  const groups = vi.fn();
  const disconnected = vi.fn();
  const errors = vi.fn();
  client.on("connected", connected);
  const unsubscribe = client.on("groupDiscovered", groups);
  client.on("disconnected", disconnected);
  client.on("error", errors);
  const task = client.start();
  try {
    sdk.emit("ready", {});
    sdk.emit("resumed", {});
    sdk.emit("message", {}, { kind: "group", groupOpenid: "GROUP" });
    sdk.emit("message", {}, { kind: "c2c", groupOpenid: "IGNORE" });
    sdk.emit("rawEvent", { eventType: "GROUP_ADD_ROBOT", data: { group_openid: "ADDED" } });
    sdk.emit("rawEvent", { eventType: "FRIEND_ADD", data: { group_openid: "IGNORE" } });
    expect(connected).toHaveBeenCalledTimes(2);
    expect(groups.mock.calls).toEqual([
      [{ openid: "GROUP", source: "message" }],
      [{ openid: "ADDED", source: "added" }],
    ]);
    unsubscribe();
    sdk.emit("message", {}, { kind: "group", groupOpenid: "AFTER_UNSUBSCRIBE" });
    expect(groups).toHaveBeenCalledTimes(2);
    sdk.emit("disconnected", { code: 1006, willReconnect: true });
    expect(disconnected).toHaveBeenCalledWith({ code: 1006, willReconnect: true });
    const error = new Error("temporary");
    sdk.emit("error", error);
    expect(errors).toHaveBeenCalledWith(error);
  } finally {
    client.stop();
    await task;
  }
  sdk.emit("ready", {});
  expect(connected).toHaveBeenCalledTimes(2);
});

test("SDK 不可恢复错误使运行任务拒绝，调用方能处理失败", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret" });
  const sdk = instances.at(-1)!;
  const task = client.start();
  const error = new Error("GATEWAY_FATAL_CLOSE");
  sdk.rejectRun(error);
  await expect(task).rejects.toBe(error);
  client.stop();
});

test("停止后立即重启，旧运行任务收尾不会覆盖新连接状态", async () => {
  const client = new QQClient({ appId: "app", appSecret: "secret" });
  const sdk = instances.at(-1)!;
  const connected = vi.fn();
  client.on("connected", connected);
  const first = client.start();
  client.stop();
  sdk.run = new Promise((resolve, reject) => {
    sdk.resolveRun = resolve;
    sdk.rejectRun = reject;
  });
  const second = client.start();
  try {
    await first;
    sdk.emit("ready", {});
    expect(connected).toHaveBeenCalledOnce();
  } finally {
    client.stop();
    await second;
  }
});
