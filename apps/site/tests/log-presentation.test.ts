import { expect, test } from "vite-plus/test";
import {
  LOG_LEVEL_TAG_CLASSES,
  LOG_TIMESTAMP_TAG_CLASS,
  parseProjectLogRows,
} from "../shared/log-presentation.ts";

test("解析结构化日志行并保留时间、等级、来源和消息", () => {
  const rows = parseProjectLogRows("[2026/11/12 10:00:00] [INFO] [NanaBot] 启动完成");

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    timestamp: "2026/11/12 10:00:00",
    level: "info",
    levelText: "INFO",
    source: "NanaBot",
    message: "启动完成",
  });
  expect(rows[0]?.timestampClass).toBe(LOG_TIMESTAMP_TAG_CLASS);
  expect(rows[0]?.levelClass).toBe(LOG_LEVEL_TAG_CLASSES.info);
});

test("等级映射到不同底色，来源按首次出现顺序分配且保持同名同色", () => {
  const rows = parseProjectLogRows(
    [
      "[2026/11/12 10:00:00] [DEBUG] [NanaBot] 调试",
      "[2026/11/12 10:00:01] [INFO] [NanaBot:主号] 启动",
      "[2026/11/12 10:00:02] [WARN] [NanaBot:小号] 重试",
      "[2026/11/12 10:00:03] [ERROR] [NanaBot:官方号] 失败",
      "[2026/11/12 10:00:04] [INFO] [NanaBot:主号] 恢复",
      "[2026/11/12 10:00:05] [VERBOSE] [NanaBot:主号] 未知等级",
    ].join("\n"),
  );

  expect(rows.map((row) => row.level)).toEqual([
    "debug",
    "info",
    "warn",
    "error",
    "info",
    "unknown",
  ]);
  expect(
    new Set(
      ["debug", "info", "warn", "error", "unknown"].map(
        (level) => LOG_LEVEL_TAG_CLASSES[level as keyof typeof LOG_LEVEL_TAG_CLASSES],
      ),
    ).size,
  ).toBe(5);
  expect(new Set(rows.map((row) => row.timestampClass)).size).toBe(1);
  expect(rows[1]?.sourceClass).not.toBe(rows[0]?.sourceClass);
  expect(rows[2]?.sourceClass).not.toBe(rows[1]?.sourceClass);
  expect(rows[3]?.sourceClass).not.toBe(rows[2]?.sourceClass);
  expect(rows[4]?.sourceClass).toBe(rows[1]?.sourceClass);
  expect(rows[5]?.sourceClass).toBe(rows[1]?.sourceClass);
});

test("错误堆栈、普通文本和 CRLF 行按续行原样保留", () => {
  const rows = parseProjectLogRows(
    [
      "[2026/11/12 10:00:00] [ERROR] [NanaBot] 发送失败",
      "  Error: boom",
      "    at file.ts:1:1",
      "PM2 前缀不是结构化行\r",
      "",
    ].join("\n"),
  );

  expect(rows.slice(1).map((row) => row.message)).toEqual([
    "  Error: boom",
    "    at file.ts:1:1",
    "PM2 前缀不是结构化行",
    "",
  ]);
  expect(rows.slice(1).every((row) => row.timestamp === null && row.level === null)).toBe(true);
  expect(parseProjectLogRows("")).toEqual([]);
});
