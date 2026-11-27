import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { checkStorageHealth, writeLiveStatus } from "../src/index.ts";

const tempDirs: string[] = [];

function createTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "nana-storage-health-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("checkStorageHealth", () => {
  test("db 目录存在有效 SQLite 文件时只读探活通过且不创建额外文件", () => {
    const rootDir = createTempRoot();
    writeLiveStatus(
      1001,
      { streamer: "测试主播", live: false, updatedAt: "2026-01-01T00:00:00.000Z" },
      { rootDir },
    );

    expect(checkStorageHealth({ rootDir })).toBe(true);
    expect(existsSync(join(rootDir, "db", "push-log.sqlite"))).toBe(false);
  });

  test("db 目录尚未创建时探活通过且不会创建 db 目录", () => {
    const rootDir = createTempRoot();

    expect(checkStorageHealth({ rootDir })).toBe(true);
    expect(existsSync(join(rootDir, "db"))).toBe(false);
  });

  test("db 目录下存在损坏的 SQLite 文件时返回 false", () => {
    const rootDir = createTempRoot();
    mkdirSync(join(rootDir, "db"), { recursive: true });
    writeFileSync(join(rootDir, "db", "live-status.sqlite"), "corrupted sqlite content");

    expect(checkStorageHealth({ rootDir })).toBe(false);
  });

  test("db 路径为普通文件或根目录不存在时返回 false", () => {
    const rootDir = createTempRoot();
    writeFileSync(join(rootDir, "db"), "not a directory");
    expect(checkStorageHealth({ rootDir })).toBe(false);

    expect(checkStorageHealth({ rootDir: join(rootDir, "missing-root") })).toBe(false);
  });
});
