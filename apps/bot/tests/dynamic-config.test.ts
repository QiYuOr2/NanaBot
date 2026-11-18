import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { loadDynamicMonitorConfig } from "../src/dynamic/index.ts";
import { loadMonitorConfig } from "../src/monitor/index.ts";

let dir: string;
let originalCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nana-cfg-"));
  originalCwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(content: string): void {
  writeFileSync(join(dir, "nana.config.yaml"), content, "utf8");
}

test("动态配置读取所有 up，只看 dynamic: true，不要求 live: true", () => {
  writeConfig(`
up:
  - uname: 只开动态
    uid: 10001
    live: false
    dynamic: true
    qqAccount: main
    dynamicMonitorConfig:
      notifyGroups: [123]
      types: [video, opus]
      pollIntervalMinutes: 7
  - uname: 只开直播
    uid: 20002
    liveRoomId: 2002
    live: true
    liveMonitorConfig:
      notifyGroups: [9]
      messageTemplate:
        start: "播了"
  - uname: 都没开
    uid: 30003
    live: false
`);
  const dynamicConfig = loadDynamicMonitorConfig();
  expect(dynamicConfig.streamers).toHaveLength(1);
  const streamer = dynamicConfig.streamers[0];
  expect(streamer.uid).toBe(10001);
  expect(streamer.types).toEqual(["video", "opus"]);
  expect(streamer.pollIntervalMinutes).toBe(7);
  expect(streamer.notifyGroups).toEqual([123]);

  // 直播配置只保留 live:true，且不受动态条目影响。
  const monitorConfig = loadMonitorConfig();
  expect(monitorConfig.streamers.map((entry) => entry.uid)).toEqual([20002]);
});

test("dynamic 默认 false，老配置无该字段不产生动态监控", () => {
  writeConfig(`
up:
  - uname: 老主播
    uid: 10001
    liveRoomId: 1001
    live: true
    liveMonitorConfig:
      notifyGroups: [9]
      messageTemplate:
        start: "播了"
`);
  expect(loadDynamicMonitorConfig().streamers).toHaveLength(0);
  expect(loadMonitorConfig().streamers).toHaveLength(1);
});

test("动态配置默认值：types 默认 video/opus/draw，pollIntervalMinutes 默认 5", () => {
  writeConfig(`
up:
  - uname: 默认值
    uid: 10001
    live: false
    dynamic: true
`);
  const streamer = loadDynamicMonitorConfig().streamers[0];
  expect(streamer.types).toEqual(["video", "opus", "draw"]);
  expect(streamer.pollIntervalMinutes).toBe(5);
  expect(streamer.enableNotify).toBe(true);
  expect(streamer.notifyGroups).toEqual([]);
});

test("live: true 缺少 liveRoomId 时报错（不影响动态-only 条目）", () => {
  writeConfig(`
up:
  - uname: 缺字段
    uid: 10001
    live: true
    liveMonitorConfig:
      notifyGroups: [9]
      messageTemplate:
        start: "播了"
`);
  expect(() => loadMonitorConfig()).toThrow();
});
