import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vite-plus/test";
import { DATABASE_DIRECTORY, PUSH_LOG_FILE } from "@nana/constants";
import { readPushLogs, writePushLog } from "../src/index.ts";
import { createRootDir } from "./setup.ts";

test("写入并读取推送记录（成功与失败）", () => {
  const rootDir = createRootDir();

  writePushLog(
    {
      targetId: "1101365727",
      target: "饭友群",
      purpose: "live.start",
      purposeLabel: "开播",
      pushedAt: "2026-08-28T08:00:00.000Z",
      success: true,
      account: "main",
      content: "饭总播了",
      subject: "饭总",
    },
    { rootDir },
  );
  writePushLog(
    {
      targetId: "1101365727",
      target: "饭友群",
      purpose: "app.offline",
      purposeLabel: "下线",
      pushedAt: "2026-08-28T09:00:00.000Z",
      success: false,
      error: "ws 未连接",
    },
    { rootDir },
  );

  expect(existsSync(join(rootDir, DATABASE_DIRECTORY, PUSH_LOG_FILE))).toBe(true);

  const logs = readPushLogs({ rootDir });
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({
    targetId: "1101365727",
    target: "饭友群",
    purpose: "app.offline",
    purposeLabel: "下线",
    success: false,
    account: null,
    error: "ws 未连接",
  });
  expect(logs[1]).toMatchObject({
    targetId: "1101365727",
    target: "饭友群",
    purpose: "live.start",
    purposeLabel: "开播",
    success: true,
    account: "main",
    content: "饭总播了",
    subject: "饭总",
  });
});

test("readPushLogs 按推送时间倒序并限制条数", () => {
  const rootDir = createRootDir();

  for (let i = 0; i < 3; i++) {
    writePushLog(
      {
        targetId: "123",
        target: "测试群",
        purpose: "notification",
        purposeLabel: "通知",
        pushedAt: `2026-08-28T0${i}:00:00.000Z`,
        success: true,
      },
      { rootDir },
    );
  }

  const logs = readPushLogs({ rootDir }, 2);
  expect(logs).toHaveLength(2);
  expect(logs[0].pushedAt).toBe("2026-08-28T02:00:00.000Z");
  expect(logs[1].pushedAt).toBe("2026-08-28T01:00:00.000Z");
});

test("空数据库返回空数组", () => {
  const rootDir = createRootDir();
  expect(readPushLogs({ rootDir })).toEqual([]);
});

test("旧库缺少 account 列时自动补列", () => {
  const rootDir = createRootDir();
  const filePath = join(rootDir, DATABASE_DIRECTORY, PUSH_LOG_FILE);
  const database = new DatabaseSync(filePath);
  database.exec(`
    CREATE TABLE push_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      target TEXT NOT NULL,
      purpose TEXT NOT NULL,
      purpose_label TEXT NOT NULL,
      pushed_at TEXT NOT NULL,
      success INTEGER NOT NULL CHECK (success IN (0, 1)),
      error TEXT,
      content TEXT,
      subject TEXT
    ) STRICT;
  `);
  database.close();

  writePushLog(
    {
      targetId: "123",
      target: "测试群",
      purpose: "notification",
      purposeLabel: "通知",
      pushedAt: "2026-08-28T00:00:00.000Z",
      success: true,
      account: "second",
    },
    { rootDir },
  );

  expect(readPushLogs({ rootDir })[0]).toMatchObject({ account: "second" });
});
