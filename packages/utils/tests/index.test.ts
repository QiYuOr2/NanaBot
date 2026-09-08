import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { NANA_CONFIG_FILE } from "@nana/constants";
import { formatDuration, resolveProjectRoot, setDeepPath } from "../src/index.ts";

test("resolveProjectRoot 从子目录向上定位项目根目录", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-utils-"));
  writeFileSync(join(rootDir, NANA_CONFIG_FILE), "", "utf8");
  mkdirSync(join(rootDir, "apps", "bot"), { recursive: true });
  const originalCwd = process.cwd();

  try {
    process.chdir(join(rootDir, "apps", "bot"));

    expect(resolveProjectRoot()).toBe(resolve(rootDir));
  } finally {
    process.chdir(originalCwd);
  }
});

test("resolveProjectRoot 支持直接指定 rootDir", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-utils-"));

  expect(resolveProjectRoot(rootDir)).toBe(resolve(rootDir));
});

test("setDeepPath 创建中间对象并设置深层值", () => {
  const target: Record<string | number, unknown> = {};

  setDeepPath(target, "a.b.c", 1);

  expect(target).toEqual({ a: { b: { c: 1 } } });
});

test("setDeepPath 支持数组路径", () => {
  const target: Record<string | number, unknown> = {};

  setDeepPath(target, ["a", "b"], 2);

  expect(target).toEqual({ a: { b: 2 } });
});

test("setDeepPath 空路径抛出", () => {
  expect(() => setDeepPath({}, "", 1)).toThrow();
});

test("formatDuration 用 dayjs 格式化毫秒时长", () => {
  expect(formatDuration(3_660_000)).toBe("1 小时 1 分钟");
  expect(formatDuration(50_000)).toBe("50 秒");
  expect(formatDuration(90_000_000)).toBe("25 小时");
  expect(formatDuration(0)).toBe("0 秒");
  expect(formatDuration(-5_000)).toBe("0 秒");
});
