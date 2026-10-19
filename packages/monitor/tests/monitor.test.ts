import type { DanmuMsg, Message } from "blive-message-listener";
import { expect, test } from "vite-plus/test";
import {
  createMonitor,
  type MonitorController,
  type MonitorEvent,
  type MonitorLogger,
  type MonitorSink,
  type MonitorSource,
  type MonitorSourceHandlers,
  type MonitorSubscription,
} from "../src/index.ts";
// source 的映射函数刻意不进 barrel（不扩大包对外面），测试直接从源文件引
import { toDanmuHandlerEvent } from "../src/source.ts";

const T0 = new Date("2026-08-22T10:00:00.000Z");

const silentLogger: MonitorLogger = { log() {}, error() {} };

type FakeSource = {
  source: MonitorSource;
  /** 取出 createMonitor 注册进来的 handlers；未 start 时抛错。 */
  handlers(): MonitorSourceHandlers;
  /** 订阅是否已被关闭。 */
  closed(): boolean;
};

/** 假的监控源：记录 handlers，供测试手动触发各个回调。 */
function createFakeSource(): FakeSource {
  let captured: MonitorSourceHandlers | undefined;
  let closeCount = 0;

  return {
    source: {
      listen(_roomId, handlers): MonitorSubscription {
        captured = handlers;
        return {
          close() {
            closeCount += 1;
          },
        };
      },
    },
    handlers() {
      if (!captured) {
        throw new Error("monitor 尚未 start()");
      }
      return captured;
    },
    closed() {
      return closeCount > 0;
    },
  };
}

/** 记录收到的所有监控事件。 */
function createRecordingSink(): { sink: MonitorSink; events: MonitorEvent[] } {
  const events: MonitorEvent[] = [];
  return {
    sink: {
      handle(event) {
        events.push(event);
      },
    },
    events,
  };
}

type SetupOptions = {
  roomId?: number;
  streamer?: string;
  messages?: { liveStart?: string; liveEnd?: string };
  sinks?: MonitorSink[];
  logger?: MonitorLogger;
};

/** 用假 source + 记录型 sink 创建并启动一个 monitor。 */
function setup(options: SetupOptions = {}): {
  fake: FakeSource;
  handlers(): MonitorSourceHandlers;
  events: MonitorEvent[];
  monitor: MonitorController;
} {
  const fake = createFakeSource();
  const recording = createRecordingSink();
  const monitor = createMonitor({
    roomId: options.roomId ?? 123,
    streamer: options.streamer ?? "Nana",
    messages: options.messages,
    source: fake.source,
    sinks: options.sinks ?? [recording.sink],
    logger: options.logger ?? silentLogger,
  });
  monitor.start();

  return { fake, handlers: fake.handlers, events: recording.events, monitor };
}

test("收到弹幕时透传 roomId / streamer / 内容与发送者信息", () => {
  const { handlers, events } = setup({ roomId: 123, streamer: "Nana" });

  handlers().onIncomeDanmu({
    timestamp: T0,
    content: "主播好可爱",
    userId: 456,
    username: "观众甲",
  });

  expect(events).toEqual([
    {
      type: "danmu.received",
      roomId: 123,
      streamer: "Nana",
      content: "主播好可爱",
      userId: 456,
      username: "观众甲",
      timestamp: T0,
    },
  ]);
});

test("空内容弹幕不产生 danmu.received 事件", () => {
  const { handlers, events } = setup();

  handlers().onIncomeDanmu({ timestamp: T0, content: "", userId: 456, username: "观众甲" });

  expect(events).toEqual([]);
});

test("内容为 qiyuor2 时保留 monitor.test 行为，并同时透传弹幕", () => {
  const { handlers, events } = setup({ roomId: 999, streamer: "主播" });

  handlers().onIncomeDanmu({ timestamp: T0, content: "qiyuor2", userId: 1, username: "测试" });

  expect(events).toEqual([
    {
      type: "danmu.received",
      roomId: 999,
      streamer: "主播",
      content: "qiyuor2",
      userId: 1,
      username: "测试",
      timestamp: T0,
    },
    {
      type: "monitor.test",
      roomId: 999,
      streamer: "主播",
      timestamp: T0,
    },
  ]);
});

test("开播事件只在 hasLiveTime 时发出，推流 LOG 不发出", () => {
  const { handlers, events } = setup({ roomId: 123, streamer: "Nana" });

  handlers().onLiveStart({ timestamp: T0, hasLiveTime: true });
  handlers().onLiveStart({ timestamp: T0, hasLiveTime: false });

  expect(events).toEqual([
    {
      type: "live.started",
      roomId: 123,
      streamer: "Nana",
      message: "Nana 开始直播",
      timestamp: T0,
    },
  ]);
});

test("下播事件保留自定义文案模板", () => {
  const { handlers, events } = setup({
    roomId: 123,
    streamer: "Nana",
    messages: { liveEnd: "{uname} 在 {roomId} 下播了" },
  });

  handlers().onLiveEnd({ timestamp: T0 });

  expect(events).toEqual([
    {
      type: "live.ended",
      roomId: 123,
      streamer: "Nana",
      message: "Nana 在 123 下播了",
      timestamp: T0,
    },
  ]);
});

test("连接打开 / 关闭 / 异常都会透传给 sink", () => {
  const { handlers, events } = setup({ roomId: 123, streamer: "Nana" });
  const error = new Error("boom");

  handlers().onOpen();
  handlers().onClose();
  handlers().onError(error);

  expect(events).toEqual([
    { type: "connection.open", roomId: 123, streamer: "Nana" },
    { type: "connection.close", roomId: 123, streamer: "Nana" },
    { type: "connection.error", roomId: 123, streamer: "Nana", error },
  ]);
});

test("重复 start 只监听一次，stop 后关闭订阅且可以再次 start", async () => {
  const fake = createFakeSource();
  let listenCount = 0;
  const source: MonitorSource = {
    listen(roomId, handlers) {
      listenCount += 1;
      return fake.source.listen(roomId, handlers);
    },
  };
  const monitor = createMonitor({
    roomId: 123,
    streamer: "Nana",
    source,
    sinks: [],
    logger: silentLogger,
  });

  monitor.start();
  monitor.start();
  expect(listenCount).toBe(1);

  await monitor.stop();
  expect(fake.closed()).toBe(true);

  monitor.start();
  expect(listenCount).toBe(2);
});

test("异步 sink 抛错不会影响其他 sink 收到事件，并交给 logger 记录", async () => {
  const recording = createRecordingSink();
  const errors: string[] = [];
  const { handlers } = setup({
    sinks: [
      {
        async handle() {
          throw new Error("sink 失败");
        },
      },
      recording.sink,
    ],
    logger: {
      log() {},
      error(message, error) {
        errors.push(`${message}: ${error instanceof Error ? error.message : String(error)}`);
      },
    },
  });

  handlers().onIncomeDanmu({ timestamp: T0, content: "你好", userId: 1, username: "观众" });
  // 异步 sink 的拒绝在下一次微任务里被 emit 捕获
  await Promise.resolve();

  expect(recording.events).toHaveLength(1);
  expect(errors).toEqual(["处理监控事件 danmu.received 失败: sink 失败"]);
});

/** 构造一条最小的 blive DanmuMsg，只填映射关心的字段。 */
function createDanmuMessage(overrides: {
  timestamp?: number;
  content?: string;
  user?: Partial<DanmuMsg["user"]>;
  /** 显式删掉 body.user，模拟畸形消息。 */
  dropUser?: boolean;
}): Message<DanmuMsg> {
  const body = {
    content: overrides.content ?? "主播好可爱",
    type: 1,
    content_color: "#ffffff",
    timestamp: overrides.timestamp ?? T0.getTime(),
    lottery: false,
    user: { uid: 456, uname: "观众甲", ...overrides.user },
  } as DanmuMsg;

  if (overrides.dropUser) {
    delete (body as { user?: DanmuMsg["user"] }).user;
  }

  return {
    id: "msg-1",
    timestamp: overrides.timestamp ?? T0.getTime(),
    type: "DANMU_MSG",
    body,
    raw: {},
  };
}

test("source 映射：body.user.uid / body.user.uname 分别落到 userId / username", () => {
  const message = createDanmuMessage({
    content: "主播好可爱",
    user: { uid: 789, uname: "观众乙" },
  });

  expect(toDanmuHandlerEvent(message)).toEqual({
    timestamp: T0,
    content: "主播好可爱",
    userId: 789,
    username: "观众乙",
  });
});

test("source 映射：timestamp 由毫秒时间戳转成 Date", () => {
  const message = createDanmuMessage({ timestamp: 1_792_000_000_000 });

  expect(toDanmuHandlerEvent(message).timestamp).toEqual(new Date(1_792_000_000_000));
});

test("source 映射：畸形消息缺少 user 时兜底为 userId 0 / username 空串", () => {
  const message = createDanmuMessage({ dropUser: true });

  expect(toDanmuHandlerEvent(message)).toMatchObject({ userId: 0, username: "" });
});

test("source 映射：user 上缺 uid / uname 时分别兜底，不抛错", () => {
  const message = createDanmuMessage({ user: { uid: undefined, uname: undefined } });

  expect(toDanmuHandlerEvent(message)).toMatchObject({ userId: 0, username: "" });
});
