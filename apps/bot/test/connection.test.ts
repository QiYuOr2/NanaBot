import { expect, test } from "vite-plus/test";
import {
  ConnectionSupervisor,
  settleWithin,
  type ConnectionLogger,
  type ConnectionSupervisorOptions,
} from "../src/core/connection.ts";

type SocketHandler = (context: unknown) => void;

interface FakeWsState {
  reconnectCalls: number;
  probeCalls: number;
}

/** 手动触发事件的假 NCWebsocket：只实现看门狗用到的那部分。 */
function createFakeWs(overrides: { get_status?: () => Promise<unknown> } = {}) {
  const handlers = new Map<string, SocketHandler[]>();
  const state: FakeWsState = { reconnectCalls: 0, probeCalls: 0 };

  const ws = {
    subscribe(event: string, handler: SocketHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        const current = handlers.get(event) ?? [];
        const index = current.indexOf(handler);
        if (index >= 0) {
          current.splice(index, 1);
        }
      };
    },
    async reconnect() {
      state.reconnectCalls += 1;
    },
    async get_status() {
      state.probeCalls += 1;
      return overrides.get_status ? await overrides.get_status() : { online: true };
    },
  };

  const emit = (event: string, context: unknown = {}) => {
    for (const handler of handlers.get(event) ?? []) {
      handler(context);
    }
  };

  return { ws, emit, state };
}

function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

const SOCKET_CONTEXT = {
  code: 1006,
  reason: "",
  reconnection: { enable: true, attempts: Number.POSITIVE_INFINITY, delay: 5_000, nowAttempts: 3 },
};

function createLogger(lines: string[]): ConnectionLogger {
  return {
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message),
  };
}

function createHarness(
  options: {
    get_status?: () => Promise<unknown>;
    supervisor?: ConnectionSupervisorOptions;
  } = {},
) {
  const { ws, emit, state } = createFakeWs({ get_status: options.get_status });
  const clock = createClock();
  const logs: string[] = [];
  const supervisor = new ConnectionSupervisor(ws as never, {
    now: clock.now,
    logger: createLogger(logs),
    ...options.supervisor,
  });

  return { supervisor, emit, state, clock, logs };
}

/** 让 forceReconnect 里的 Promise 链跑完。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 断言日志必需关闭节流（`logThrottleMs: 0`），否则同窗口内的日志会被吃掉。 */
const NO_THROTTLE: ConnectionSupervisorOptions = { logThrottleMs: 0 };

test("socket.open / socket.close 会同步连接状态", () => {
  const { supervisor, emit } = createHarness();
  supervisor.start();

  expect(supervisor.isConnected).toBe(false);

  emit("socket.open", SOCKET_CONTEXT);
  expect(supervisor.isConnected).toBe(true);

  emit("socket.close", SOCKET_CONTEXT);
  expect(supervisor.isConnected).toBe(false);

  supervisor.stop();
});

test("断开后库仍在重试时看门狗不插手", async () => {
  const { supervisor, emit, state, clock } = createHarness();
  supervisor.start();

  emit("socket.open", SOCKET_CONTEXT);
  emit("socket.close", SOCKET_CONTEXT);

  // 库每 5s 自己重试一次，会不断刷新 socket 活动时间。
  clock.advance(5_000);
  emit("socket.connecting", SOCKET_CONTEXT);
  clock.advance(5_000);
  await supervisor.check();

  expect(state.reconnectCalls).toBe(0);
  supervisor.stop();
});

test("断开后长时间没有重连活动时强制重建连接", async () => {
  const { supervisor, emit, state, clock, logs } = createHarness({
    supervisor: NO_THROTTLE,
  });
  supervisor.start();

  emit("socket.open", SOCKET_CONTEXT);
  emit("socket.close", SOCKET_CONTEXT);

  clock.advance(19_000);
  await supervisor.check();
  expect(state.reconnectCalls).toBe(0);

  clock.advance(1_000);
  await supervisor.check();
  await flush();

  expect(state.reconnectCalls).toBe(1);
  expect(logs.some((line) => line.includes("强制重建连接"))).toBe(true);
  supervisor.stop();
});

test("库被失败响应关掉自动重连后仍由看门狗接管", async () => {
  const { supervisor, emit, state, clock, logs } = createHarness({
    supervisor: NO_THROTTLE,
  });
  supervisor.start();

  emit("socket.error", {
    error_type: "response_error",
    reconnection: { enable: false, attempts: 5, delay: 5_000, nowAttempts: 1 },
  });

  expect(logs.some((line) => line.includes("库已永久关闭自动重连"))).toBe(true);

  clock.advance(20_000);
  await supervisor.check();
  await flush();

  expect(state.reconnectCalls).toBe(1);
  supervisor.stop();
});

test("已连接但长时间收不到事件且探活失败时强制重建连接", async () => {
  const { supervisor, emit, state, clock } = createHarness({
    get_status: async () => {
      throw new Error("api response timeout");
    },
  });
  supervisor.start();

  emit("socket.open", SOCKET_CONTEXT);
  clock.advance(60_000);
  await supervisor.check();
  await flush();

  expect(state.probeCalls).toBe(1);
  expect(state.reconnectCalls).toBe(1);
  supervisor.stop();
});

test("已连接且探活成功时不重连，并刷新入向活跃时间", async () => {
  const { supervisor, emit, state, clock } = createHarness();
  supervisor.start();

  emit("socket.open", SOCKET_CONTEXT);
  clock.advance(60_000);
  await supervisor.check();

  expect(state.probeCalls).toBe(1);
  expect(state.reconnectCalls).toBe(0);

  // 探活成功等价于一次入向活动：再走不到 inboundIdleMs 不会立刻再探。
  clock.advance(59_000);
  await supervisor.check();
  expect(state.probeCalls).toBe(1);

  supervisor.stop();
});

test("收到 NapCat 事件会刷新入向活跃时间，避免误判半开连接", async () => {
  const { supervisor, emit, state, clock } = createHarness();
  supervisor.start();

  emit("socket.open", SOCKET_CONTEXT);
  clock.advance(50_000);
  emit("meta_event", {});
  clock.advance(50_000);
  await supervisor.check();

  expect(state.probeCalls).toBe(0);
  expect(state.reconnectCalls).toBe(0);
  supervisor.stop();
});

test("强制重建连接受冷却时间限制，不会连发", async () => {
  const { supervisor, emit, state, clock } = createHarness();
  supervisor.start();

  emit("socket.close", SOCKET_CONTEXT);
  clock.advance(20_000);
  await supervisor.check();
  await flush();
  expect(state.reconnectCalls).toBe(1);

  // 冷却时间内（默认 5s）再巡检一次不应重复触发。
  await supervisor.check();
  await flush();
  expect(state.reconnectCalls).toBe(1);

  // 超过冷却时间后才会再次触发。
  clock.advance(5_000);
  await supervisor.check();
  await flush();
  expect(state.reconnectCalls).toBe(2);
  supervisor.stop();
});

test("stop() 会退订连接事件", () => {
  const { supervisor, emit } = createHarness();
  supervisor.start();
  supervisor.stop();

  emit("socket.open", SOCKET_CONTEXT);
  expect(supervisor.isConnected).toBe(false);
});

test("长期离线时日志被节流：21 次断开只留 1 条详情 + 1 条摘要", () => {
  const { supervisor, emit, logs, clock } = createHarness({
    supervisor: { logThrottleMs: 60_000 },
  });
  supervisor.start();

  emit("socket.open", SOCKET_CONTEXT);
  emit("socket.close", SOCKET_CONTEXT);

  // 库每 5 秒失败一次，共 100 秒。
  for (let index = 0; index < 20; index += 1) {
    clock.advance(5_000);
    emit("socket.close", SOCKET_CONTEXT);
  }

  expect(logs.filter((line) => line.includes("已连接"))).toHaveLength(1);
  expect(logs.filter((line) => line.includes("NapCat WebSocket 断开"))).toHaveLength(1);
  expect(logs.filter((line) => line.includes("仍未连上 NapCat"))).toHaveLength(1);
  expect(logs).toHaveLength(3);
  supervisor.stop();
});

test("故障恢复后「已连接」日志不会被节流吃掉", () => {
  const { supervisor, emit, logs, clock } = createHarness({
    supervisor: { logThrottleMs: 60_000 },
  });
  supervisor.start();

  emit("socket.open", SOCKET_CONTEXT);
  clock.advance(5_000);
  emit("socket.close", SOCKET_CONTEXT);

  // 长时间离线：一直连不上。
  for (let index = 0; index < 25; index += 1) {
    clock.advance(5_000);
    emit("socket.close", SOCKET_CONTEXT);
  }

  emit("socket.open", SOCKET_CONTEXT);
  expect(logs.filter((line) => line.includes("已连接"))).toHaveLength(2);
  supervisor.stop();
});

test("settleWithin 区分 resolve、reject 与超时", async () => {
  await expect(settleWithin(Promise.resolve(1), 50)).resolves.toBe(true);
  await expect(settleWithin(Promise.reject(new Error("boom")), 50)).resolves.toBe(false);
  await expect(settleWithin(new Promise(() => {}), 20)).resolves.toBe(false);
});
