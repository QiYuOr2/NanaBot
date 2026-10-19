import { expect, test } from "vite-plus/test";
import {
  buildPushActivities,
  collectPushActivityFailures,
  summarizePushActivities,
  PUSH_SESSION_GAP_MS,
} from "../shared/push-activity.ts";
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
    targetCount: 6,
    pendingTargetCount: 0,
    retryCount: 0,
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
  expect(activities[0]).toMatchObject({
    successCount: 1,
    failureCount: 1,
    targetCount: 2,
  });
  const failedTarget = activities[0]?.targets.find((item) => item.targetId === "2");
  expect(failedTarget?.success).toBe(false);
  expect(failedTarget?.error).toBe("ws 未连接");
  expect(failedTarget?.attemptCount).toBe(1);
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
  expect(activities[0]?.targets[0]).toMatchObject({
    success: true,
    error: null,
    attemptCount: 2,
    failedAttemptCount: 1,
  });
  // 失败的那次推送仍然保留在原始记录里。
  expect(activities[0]?.items).toHaveLength(2);
  // 失败计数按「最终没送达的群」算，重试后送达不算失败。
  expect(activities[0]?.failureCount).toBe(0);
});

test("失败后重试成功的活动不再显示为失败", () => {
  // 回归：曾经把「原始记录里的失败条数」直接当成活动失败数，
  // 于是「1 个群重试后送达」的活动会同时显示「2 失败」和「已送达」，自相矛盾。
  const activities = buildPushActivities([
    createLog({
      targetId: "1",
      target: "群1",
      success: false,
      error: "ws 未连接",
      pushedAt: "2026-09-15T02:00:00.000Z",
    }),
    createLog({
      targetId: "1",
      target: "群1",
      success: true,
      pushedAt: "2026-09-15T02:00:30.000Z",
    }),
    createLog({
      targetId: "2",
      target: "群2",
      success: false,
      error: "超时",
      pushedAt: "2026-09-15T02:00:30.000Z",
    }),
    createLog({
      targetId: "2",
      target: "群2",
      success: true,
      pushedAt: "2026-09-15T02:01:00.000Z",
    }),
  ]);

  expect(activities).toHaveLength(1);
  expect(activities[0]).toMatchObject({
    successCount: 2,
    failureCount: 0,
    targetCount: 2,
    pendingTargetCount: 0,
    retryCount: 2,
  });
  // 原始失败记录一条不少。
  expect(activities[0]?.items.filter((item) => !item.success)).toHaveLength(2);
});

test("仍有群没收到时只统计真正失败的群", () => {
  const activities = buildPushActivities([
    createLog({
      targetId: "1",
      success: false,
      error: "ws 未连接",
      pushedAt: "2026-09-15T02:00:00.000Z",
    }),
    createLog({ targetId: "1", success: true, pushedAt: "2026-09-15T02:00:10.000Z" }),
    createLog({
      targetId: "2",
      success: false,
      error: "超时",
      pushedAt: "2026-09-15T02:00:10.000Z",
    }),
    createLog({ targetId: "3", success: true, pushedAt: "2026-09-15T02:00:10.000Z" }),
  ]);

  expect(activities[0]).toMatchObject({
    successCount: 2,
    failureCount: 1,
    targetCount: 3,
    retryCount: 1,
  });
});

test("未满一分钟就超时的群标记为待确认，而不是失败", () => {
  const activities = buildPushActivities(
    [
      createLog({
        targetId: "1",
        success: false,
        error: "已发送，未收到回执",
        pushedAt: "2026-09-15T02:00:00.000Z",
      }),
      createLog({ targetId: "2", success: true, pushedAt: "2026-09-15T02:00:00.300Z" }),
    ],
    {
      now: "2026-09-15T02:00:40.000Z",
      pendingWindowMs: 60_000,
    },
  );

  expect(activities[0]).toMatchObject({
    successCount: 1,
    failureCount: 0,
    pendingTargetCount: 1,
  });
  expect(activities[0]?.targets.find((item) => item.targetId === "1")?.status).toBe("pending");
});

test("服务重启重连时写入的上线活动不再误判为失败", () => {
  // 回归：bot 在 `socket.open` 时推送「我来了~」，与 NapCat 重连前的失败推送一起
  // 落进同一个 30 分钟窗口。成员只有上线通知 + 失败通知，没有开播记录，
  // 旧逻辑会把整条活动标成「2 失败」，看起来像上线通知失败了。
  const failedStart = createLog({
    subject: null,
    targetId: "1",
    target: "群1",
    purpose: "live.start",
    success: false,
    error: "ws 未连接",
    content: null,
    pushedAt: "2026-09-15T02:00:00.000Z",
  });
  const online = createLog({
    subject: null,
    targetId: "2",
    target: "管理群",
    purpose: "app.online",
    purposeLabel: "上线",
    success: true,
    content: "我来了~",
    pushedAt: "2026-09-15T02:10:00.000Z",
  });
  const failureNotice = createLog({
    subject: null,
    targetId: "2",
    target: "管理群",
    purpose: "notification",
    purposeLabel: "错误",
    success: false,
    error: "ws 未连接",
    content: '向群 1 发送 "饭总" 开播通知失败',
    pushedAt: "2026-09-15T02:10:00.100Z",
  });

  const activities = buildPushActivities([failedStart, online, failureNotice]);

  expect(activities).toHaveLength(3);
  const onlineActivity = activities.find((item) => item.purpose === "app.online");
  expect(onlineActivity).toMatchObject({ successCount: 1, failureCount: 0, targetCount: 1 });
  // 失败推送 / 失败通知本身仍单独成条并如实标记。
  expect(activities.filter((item) => item.failureCount > 0)).toHaveLength(2);
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

test("汇总面板口径：失败按群去重，跨活动统计", () => {
  // 同一场直播里群 2 重试后送达（不算失败），另一场直播里群 1 最终失败。
  const activities = buildPushActivities([
    createLog({
      targetId: "1",
      success: false,
      error: "ws 未连接",
      pushedAt: "2026-09-15T02:00:00.000Z",
    }),
    createLog({
      targetId: "2",
      success: false,
      error: "超时",
      pushedAt: "2026-09-15T02:00:00.100Z",
    }),
    createLog({ targetId: "2", success: true, pushedAt: "2026-09-15T02:00:30.000Z" }),
    createLog({ targetId: "3", success: true, pushedAt: "2026-09-15T03:00:00.000Z" }),
  ]);

  expect(summarizePushActivities(activities)).toEqual({
    activityCount: 2,
    deliveredActivityCount: 1,
    failedActivityCount: 1,
    pendingActivityCount: 0,
    failedTargetCount: 1,
    pendingTargetCount: 0,
  });
});

test("失败明细按群去重并带上错误信息与重试次数", () => {
  const activities = buildPushActivities([
    createLog({
      targetId: "1",
      target: "群1",
      success: false,
      error: "ws 未连接",
      pushedAt: "2026-09-15T02:00:00.000Z",
    }),
    createLog({
      targetId: "1",
      target: "群1",
      success: false,
      error: "超时",
      pushedAt: "2026-09-15T02:01:00.000Z",
    }),
    createLog({
      targetId: "2",
      target: "群2",
      success: true,
      pushedAt: "2026-09-15T02:01:00.000Z",
    }),
  ]);

  const failures = collectPushActivityFailures(activities);

  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({
    targetId: "1",
    target: "群1",
    error: "超时",
    status: "failed",
    attemptCount: 2,
  });
  expect(failures[0]?.purposeLabel).toBe("开播");
});
