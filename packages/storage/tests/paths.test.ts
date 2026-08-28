import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { DATABASE_DIRECTORY } from "@nana/constants";
import { resolveDbPath } from "../src/index.ts";
import { createRootDir } from "./setup.ts";

test("构建 db 目录内的存储路径", () => {
  const rootDir = createRootDir();

  expect(resolveDbPath("nested/status.yaml", { rootDir })).toBe(
    join(rootDir, DATABASE_DIRECTORY, "nested", "status.yaml"),
  );
});

test("拒绝访问 db 目录之外的文件", () => {
  const rootDir = createRootDir();

  expect(() => resolveDbPath("../outside.yaml", { rootDir })).toThrow();
  expect(() => resolveDbPath(join(rootDir, "outside.yaml"), { rootDir })).toThrow();
});
