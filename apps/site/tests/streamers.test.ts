import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { loadStreamerConfigs } from "../server/utils/streamers.ts";

/** 在临时目录写一份 nana.config.yaml 并切过去，让 readConfig 读到它。 */
function withTempConfig<T>(yaml: string, run: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "nana-streamers-"));
  writeFileSync(join(dir, "nana.config.yaml"), yaml, "utf8");
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
}

test("live: false 且没有 liveRoomId 的条目（只开动态监控）被跳过，不再让整页 500", () => {
  const yaml = [
    "up:",
    "  - live: true",
    "    uid: 145149047",
    "    liveRoomId: 4629447",
    "    uname: 饭总",
    "  - dynamic: true",
    "    live: false",
    '    qqAccount: "777002"',
    "    uid: 11372620",
    "    uname: 寻子清",
    "",
  ].join("\n");

  const streamers = withTempConfig(yaml, () => loadStreamerConfigs());
  expect(streamers).toEqual([{ uid: 145149047, roomId: 4629447, streamer: "饭总" }]);
});

test("live: true 却缺 liveRoomId 仍然是配置错误", () => {
  const yaml = ["up:", "  - live: true", "    uid: 1", "    uname: 缺房间", ""].join("\n");
  expect(() => withTempConfig(yaml, () => loadStreamerConfigs())).toThrow();
});
