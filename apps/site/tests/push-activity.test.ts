import { expect, test } from "vite-plus/test";
import { buildPushActivities, PUSH_SESSION_GAP_MS } from "../shared/push-activity.ts";
import type { PushLogItem } from "../shared/push-log.ts";

let nextId = 1;

function createLog(overrides: Partial<PushLogItem> = {}): PushLogItem {
  return {
    id: nextId++,
    targetId: "1101365727",
    target: "饭友群",
    purpose: "live.start",
    purposeLabel: "开播",
    pushedAt: "2026-09-15T12:00:00.000Z",
    success: true,
    error: null,
    content: "饭总播了",
    subject: "饭总",
    ...overrides,
  };
}

test("同一次直播发往多个群的推送合并成一条活动", () => {
  const groupIds = [
    "1101365727",
    "511731882",
    "1045653883",
    "1092028491",
    "633120010",
    "721662821",
  ];
  const logs = groupIds.map((targetId, index) =>
    createLog({
      targetId,
      target: `群${index}`,
      pushedAt: `2026-09-15T12:00:00.00${index}Z`,
    }),
  );

  const activities = buildPushActivities(logs);

  expect(activities).toHaveLength(1);
  expect(activities[0]).toMatchObject({
    subject: "饭总",
    purpose: "live.start",
    purposeLabel: "开播",
    startedAt: "2026-09-15T12:00:00.000Z",
    latestAt: "2026-09-15T12:00:00.005Z",
    successCount: 6,
    failureCount: 0,
  });
  // 原始推送记录不能因为展示合并而丢失。
  expect(activities[0]?.items).toHaveLength(6);
  expect(activities[0]?.targets).toHaveLength(6);
});

test("默认阈值以内视为同一次直播，超过阈值拆成两次", () => {
  const start = Date.parse("2026-09-15T02:00:00.000Z");
  const at = (offset: number) => new Date(start + offset).toISOString();

  const merged = buildPushActivities([
    createLog({ pushedAt: at(0) }),
    createLog({ pushedAt: at(PUSH_SESSION_GAP_MS - 1_000) }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]?.items).toHaveLength(2);

  const split = buildPushActivities([
    createLog({ pushedAt: at(0) }),
    createLog({ pushedAt: at(PUSH_SESSION_GAP_MS + 1_000) }),
  ]);
  expect(split).toHaveLength(2);
});

test("同一主播的两场直播拆成两条并按最新时间倒序", () => {
  const morning = createLog({
    targetId: "1",
    target: "群1",
    pushedAt: "2026-09-15T02:00:00.000Z",
  });
  const morningLater = createLog({
    targetId: "2",
    target: "群2",
    pushedAt: "2026-09-15T02:00:00.500Z",
  });
  const evening = createLog({
    targetId: "1",
    target: "群1",
    pushedAt: "2026-09-15T08:00:00.000Z",
  });

  const activities = buildPushActivities([morning, evening, morningLater]);

  expect(activities).toHaveLength(2);
  expect(activities[0]?.latestAt).toBe("2026-09-15T08:00:00.000Z");
  expect(activities[0]?.items).toHaveLength(1);
  expect(activities[1]?.latestAt).toBe("2026-09-15T02:00:00.500Z");
  expect(activities[1]?.items).toHaveLength(2);
  expect(new Set(activities.map((item) => item.id)).size).toBe(2);
});

test("失败推送计入活动并保留错误信息", () => {
  const activities = buildPushActivities([
    createLog({ targetId: "1", target: "群1", pushedAt: "2026-09-15T02:00:00.000Z" }),
    createLog({
      targetId: "2",
      target: "群2",
      success: false,
      error: "ws 未连接",
      pushedAt: "2026-09-15T02:00:00.200Z",
    }),
  ]);

  expect(activities).toHaveLength(1);
  expect(activities[0]).toMatchObject({ successCount: 1, failureCount: 1 });
  const failedTarget = activities[0]?.targets.find((item) => item.targetId === "2");
  expect(failedTarget?.success).toBe(false);
  expect(failedTarget?.error).toBe("ws 未连接");
});

test("同一个群的重复推送在 targets 中保留最新一条", () => {
  const activities = buildPushActivities([
    createLog({
      targetId: "1",
      target: "群1",
      success: false,
      error: "超时",
      pushedAt: "2026-09-15T02:00:00.000Z",
    }),
    createLog({
      targetId: "1",
      target: "群1",
      success: true,
      error: null,
      pushedAt: "2026-09-15T02:00:00.800Z",
    }),
  ]);

  expect(activities[0]?.targets).toHaveLength(1);
  expect(activities[0]?.targets[0]).toMatchObject({ success: true, error: null });
  // 失败的那次推送仍然保留在原始记录里。
  expect(activities[0]?.items).toHaveLength(2);
  expect(activities[0]?.failureCount).toBe(1);
});

test("没有主播名的管理员推送各自成条，不会被合并吞掉", () => {
  const online = createLog({
    subject: null,
    purpose: "app.online",
    purposeLabel: "上线",
    content: "我来了~",
    pushedAt: "2026-09-15T03:00:00.000Z",
  });
  const notice = createLog({
    subject: null,
    purpose: "notification",
    purposeLabel: "通知",
    content: "向群 1 发送开播通知失败",
    pushedAt: "2026-09-15T03:00:00.100Z",
  });
  const live = createLog({ pushedAt: "2026-09-15T04:00:00.000Z" });

  const activities = buildPushActivities([online, notice, live]);

  expect(activities).toHaveLength(3);
  expect(activities.filter((item) => item.subject === null)).toHaveLength(2);
  expect(activities[0]?.subject).toBe("饭总");
  expect(activities[1]?.purposeLabel).toBe("通知");
  expect(activities[2]?.purposeLabel).toBe("上线");
});
