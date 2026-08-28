import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { DATABASE_DIRECTORY } from "@nana/constants";
import { readStore, updateStore, writeStore } from "../src/index.ts";
import { createRootDir } from "./setup.ts";

test("读取不存在或为空的存储文件", () => {
  const rootDir = createRootDir();

  expect(readStore("missing.yaml", { rootDir })).toBeUndefined();
  writeFileSync(join(rootDir, DATABASE_DIRECTORY, "empty.yaml"), "", "utf8");
  expect(readStore("empty.yaml", { rootDir })).toBeUndefined();
});

test("写入并读取 YAML 存储文件", () => {
  const rootDir = createRootDir();

  const filePath = writeStore("nested/status.yaml", { live: true }, { rootDir });

  expect(filePath).toBe(join(rootDir, DATABASE_DIRECTORY, "nested", "status.yaml"));
  expect(readStore("nested/status.yaml", { rootDir })).toEqual({ live: true });
  expect(readFileSync(filePath, "utf8")).toContain("live: true");
});

test("按路径更新存储内容", () => {
  const rootDir = createRootDir();

  writeStore("status.yaml", { monitor: { enabled: false } }, { rootDir });
  updateStore("status.yaml", "monitor.enabled", true, { rootDir });

  expect(readStore("status.yaml", { rootDir })).toEqual({ monitor: { enabled: true } });
});
