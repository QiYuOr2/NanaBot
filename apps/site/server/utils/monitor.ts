import { readConfig } from "@nana/config";
import { readPushLogs } from "@nana/storage";
import {
  collectGroupNames,
  monitorStreamersFromConfig,
  summarizeMonitor,
  type MonitorResponse,
  type MonitorStreamer,
} from "../../shared/monitor.ts";

/**
 * 扫描多少条推送记录来反查群昵称。
 *
 * 群名不在配置里，只在推送记录的 `target` 字段里出现过。取最近的一批即可：
 * 群改名后旧名字会被更近的记录覆盖（`collectGroupNames` 取每个群第一次出现的名字）。
 */
const GROUP_NAME_SCAN_LIMIT = 500;

/** 用最近的推送记录给配置里的群号补上群昵称。 */
function loadGroupNames(): Map<string, string> {
  const logs = readPushLogs({}, GROUP_NAME_SCAN_LIMIT);
  return new Map(collectGroupNames(logs));
}

/** 组装直播监控页的数据：配置里的主播，加上从推送记录反查到的群名。 */
export function buildMonitorView(): Omit<MonitorResponse, "generatedAt"> {
  const streamers = monitorStreamersFromConfig(readConfig(), loadGroupNames());
  return { streamers, summary: summarizeMonitor(streamers) };
}

export type { MonitorStreamer };
