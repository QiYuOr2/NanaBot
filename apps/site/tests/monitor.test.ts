import { expect, test } from "vite-plus/test";
import {
  collectGroupNames,
  fallbackGroupName,
  monitorStreamersFromConfig,
  summarizeMonitor,
  toMonitorStreamer,
  type MonitorUpInput,
} from "../shared/monitor.ts";

const fan: MonitorUpInput = {
  live: true,
  uid: 145149047,
  liveRoomId: 4629447,
  uname: "饭总",
  liveMonitorConfig: {
    enableNotify: true,
    notifyGroups: [1101365727, 511731882],
    messageTemplate: { start: "{uname}播了 http://live.bilibili.com/{roomId}" },
  },
};

test("完整的主播配置映射成监控展示数据", () => {
  const names = new Map([["1101365727", "饭友群"]]);

  const streamer = toMonitorStreamer(fan, names);

  expect(streamer).toMatchObject({
    uid: 145149047,
    roomId: 4629447,
    streamer: "饭总",
    monitored: true,
    notifyEnabled: true,
    messageTemplate: "{uname}播了 http://live.bilibili.com/{roomId}",
  });
  // 推送记录里出现过的群用真名，没出现过的回退「群 + 群号」。
  expect(streamer?.groups).toEqual([
    { id: "1101365727", name: "饭友群", fallback: false },
    { id: "511731882", name: fallbackGroupName("511731882"), fallback: true },
  ]);
});

test("缺省字段按开启处理，与直播状态页的口径一致", () => {
  const streamer = toMonitorStreamer({ uid: 1, liveRoomId: 2, uname: "某人" }, new Map());

  expect(streamer).toMatchObject({
    monitored: true,
    notifyEnabled: true,
    messageTemplate: null,
    groups: [],
  });
});

test("缺少主播名、uid 或房间号的配置项被跳过", () => {
  expect(toMonitorStreamer({ uid: 1, liveRoomId: 2 }, new Map())).toBeUndefined();
  expect(toMonitorStreamer({ uid: 1, uname: "某人" }, new Map())).toBeUndefined();
  expect(toMonitorStreamer({ liveRoomId: 2, uname: "  " }, new Map())).toBeUndefined();
});

test("重复的群号只保留第一次，非法群号被丢弃", () => {
  const streamer = toMonitorStreamer(
    {
      ...fan,
      liveMonitorConfig: {
        notifyGroups: [1101365727, "1101365727", "511731882", -1, 1.5, "01", ""],
      },
    },
    new Map(),
  );

  expect(streamer?.groups.map((group) => group.id)).toEqual(["1101365727", "511731882"]);
});

test("一条脏配置不会把其余主播一起丢掉", () => {
  const streamers = monitorStreamersFromConfig(
    {
      up: [
        fan,
        { uid: "不是数字", liveRoomId: 1, uname: "坏掉的" },
        { live: "false", uid: 9, liveRoomId: 9, uname: "类型错了" },
        { uid: 8, liveRoomId: 8, uname: "配置块坏了", liveMonitorConfig: [] },
        { uid: 7, liveRoomId: 7, uname: "下一位" },
      ],
    },
    new Map(),
  );

  expect(streamers.map((item) => item.streamer)).toEqual(["饭总", "下一位"]);
});

test("没有 up 列表时监控页是空的，而不是报错", () => {
  expect(monitorStreamersFromConfig({}, new Map())).toEqual([]);
  expect(monitorStreamersFromConfig({ up: { live: false } }, new Map())).toEqual([]);
  expect(monitorStreamersFromConfig(null, new Map())).toEqual([]);
});

test("空白的文案模板视为未配置", () => {
  const streamer = toMonitorStreamer(
    { ...fan, liveMonitorConfig: { messageTemplate: { start: "   " } } },
    new Map(),
  );

  expect(streamer?.messageTemplate).toBeNull();
});

test("群昵称取每个群最近一次的真名，回退文案不采用", () => {
  // 推送记录按时间倒序：每个群第一条就是最新的。
  const names = collectGroupNames([
    { targetId: "1", target: "新群名" },
    { targetId: "1", target: "旧群名" },
    { targetId: "2", target: "  " },
    { targetId: "3", target: fallbackGroupName("3") },
  ]);

  expect(names.get("1")).toBe("新群名");
  expect(names.has("2")).toBe(false);
  expect(names.has("3")).toBe(false);
});

test("汇总计数按监控状态与去重后的群计算", () => {
  const names = new Map<string, string>();
  const streamers = [
    toMonitorStreamer(fan, names),
    toMonitorStreamer({ ...fan, uid: 2, liveRoomId: 3, uname: "另一位", live: false }, names),
    toMonitorStreamer(
      {
        uid: 4,
        liveRoomId: 5,
        uname: "不推送",
        liveMonitorConfig: { enableNotify: false, notifyGroups: [1101365727] },
      },
      names,
    ),
  ].flatMap((item) => (item ? [item] : []));

  expect(summarizeMonitor(streamers)).toEqual({
    streamerCount: 3,
    monitoredCount: 2,
    // 关闭监控或关闭通知的主播都不算「会推送」。
    notifyingCount: 1,
    // 两个主播共用的群只计一次。
    groupCount: 2,
  });
});
