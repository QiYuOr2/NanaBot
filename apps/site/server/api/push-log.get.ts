import { defineEventHandler, getQuery } from "h3";
import { readPushLogs } from "@nana/storage";
import {
  buildPushActivities,
  PUSH_ACTIVITY_RAW_LIMIT,
  PUSH_ACTIVITY_RAW_LIMIT_MAX,
} from "../../shared/push-activity.ts";
import { toPushLogItem } from "../../shared/push-log.ts";

/** 解析 `?rawLimit=`，非法或超限时回退到默认窗口。 */
function resolveRawLimit(value: unknown): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    return PUSH_ACTIVITY_RAW_LIMIT;
  }
  return Math.min(limit, PUSH_ACTIVITY_RAW_LIMIT_MAX);
}

export default defineEventHandler((event) => {
  const rawLimit = resolveRawLimit(getQuery(event).rawLimit);
  // 多读一条用于判断是否还有更早的记录，从而知道最旧的活动是否完整。
  const records = readPushLogs({}, rawLimit + 1);
  const truncated = records.length > rawLimit;
  const logs = records.slice(0, rawLimit).map(toPushLogItem);

  const activities = buildPushActivities(logs);
  if (truncated) {
    // 窗口截断时最旧的活动可能只包含该场直播的部分推送，丢弃避免展示半场。
    activities.pop();
  }

  return { logs, activities, truncated, generatedAt: new Date().toISOString() };
});
