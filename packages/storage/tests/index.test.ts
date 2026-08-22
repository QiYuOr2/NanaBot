import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readStore, resolveDbPath, updateStore, writeStore } from "../src/index.ts";

function createRootDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), "nana-storage-"));
  writeFileSync(join(rootDir, "nana.config.yaml"), "", "utf8");
  mkdirSync(join(rootDir, "db"));
  return rootDir;
}

test("读取不存在或为空的存储文件", () => {
  const rootDir = createRootDir();

  expect(readStore("missing.yaml", { rootDir })).toBeUndefined();
  writeFileSync(join(rootDir, "db", "empty.yaml"), "", "utf8");
  expect(readStore("empty.yaml", { rootDir })).toBeUndefined();
});

test("写入并读取 YAML 存储文件", () => {
  const rootDir = createRootDir();

  const filePath = writeStore("nested/status.yaml", { live: true }, { rootDir });

  expect(filePath).toBe(join(rootDir, "db", "nested", "status.yaml"));
  expect(readStore("nested/status.yaml", { rootDir })).toEqual({ live: true });
  expect(readFileSync(filePath, "utf8")).toContain("live: true");
});

test("按路径更新存储内容", () => {
  const rootDir = createRootDir();

  writeStore("status.yaml", { monitor: { enabled: false } }, { rootDir });
  updateStore("status.yaml", "monitor.enabled", true, { rootDir });

  expect(readStore("status.yaml", { rootDir })).toEqual({ monitor: { enabled: true } });
});

test("拒绝访问 db 目录之外的文件", () => {
  const rootDir = createRootDir();

  expect(() => resolveDbPath("../outside.yaml", { rootDir })).toThrow();
  expect(() => resolveDbPath(join(rootDir, "outside.yaml"), { rootDir })).toThrow();
});
