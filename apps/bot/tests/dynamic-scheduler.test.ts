import { expect, test } from "vite-plus/test";
import { DynamicScheduler } from "../src/dynamic/index.ts";
import type { DynamicLogger } from "../src/dynamic/index.ts";

const logger: DynamicLogger = { info() {}, warn() {}, error() {} };

test("调度器并发上限生效（同时运行数不超过 concurrency）", async () => {
  let active = 0;
  let maxActive = 0;
  const scheduler = new DynamicScheduler({ concurrency: 2, jitterMs: 0, logger });
  for (let key = 1; key <= 5; key += 1) {
    scheduler.schedule({
      key,
      intervalMinutes: 60,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      },
    });
  }
  scheduler.start();
  await Promise.all([1, 2, 3, 4, 5].map((key) => scheduler.triggerNow(key)));
  scheduler.stop();
  expect(maxActive).toBeLessThanOrEqual(2);
});

test("stop 后不再执行新任务", async () => {
  let runs = 0;
  const scheduler = new DynamicScheduler({ concurrency: 1, jitterMs: 0, logger });
  scheduler.schedule({
    key: 1,
    intervalMinutes: 60,
    run: async () => {
      runs += 1;
    },
  });
  scheduler.stop();
  await scheduler.triggerNow(1);
  expect(runs).toBe(0);
  expect(scheduler.isStopped).toBe(true);
});

test("单个任务抛错不影响调度器其它任务注册与运行", async () => {
  const okRuns: number[] = [];
  const scheduler = new DynamicScheduler({
    concurrency: 2,
    jitterMs: 0,
    backoffBaseMs: 1,
    maxBackoffMs: 1,
    logger,
  });
  scheduler.schedule({
    key: 1,
    intervalMinutes: 60,
    run: async () => {
      throw new Error("boom");
    },
  });
  scheduler.schedule({
    key: 2,
    intervalMinutes: 60,
    run: async () => {
      okRuns.push(2);
    },
  });
  scheduler.start();
  await scheduler.triggerNow(1);
  await scheduler.triggerNow(2);
  scheduler.stop();
  expect(okRuns).toEqual([2]);
});
