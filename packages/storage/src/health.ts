import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  APP_STATE_FILE,
  DANMU_FILE,
  DATABASE_DIRECTORY,
  DYNAMIC_FILE,
  LIVE_STATUS_FILE,
  PUSH_LOG_FILE,
  QQ_GROUP_FILE,
} from "@nana/constants";
import { resolveProjectRoot } from "@nana/utils";
import type { StorageOptions } from "./types.ts";

const KNOWN_SQLITE_FILES = [
  LIVE_STATUS_FILE,
  PUSH_LOG_FILE,
  APP_STATE_FILE,
  DANMU_FILE,
  DYNAMIC_FILE,
  QQ_GROUP_FILE,
] as const;

const PROBE_BUSY_TIMEOUT_MS = 1000;

function probeSqliteFile(filePath: string): boolean {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(filePath, { readOnly: true });
    database.exec(`PRAGMA busy_timeout = ${PROBE_BUSY_TIMEOUT_MS};`);
    const row = database.prepare("SELECT 1 AS ok").get() as { ok?: unknown } | undefined;
    return Number(row?.ok) === 1;
  } catch {
    return false;
  } finally {
    try {
      database?.close();
    } catch {
      // 关闭阶段异常忽略，避免掩盖探活结果。
    }
  }
}

function probeInMemorySqlite(): boolean {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(":memory:");
    const row = database.prepare("SELECT 1 AS ok").get() as { ok?: unknown } | undefined;
    return Number(row?.ok) === 1;
  } catch {
    return false;
  } finally {
    try {
      database?.close();
    } catch {
      // 关闭阶段异常忽略。
    }
  }
}

function collectSqliteFiles(dbDir: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const name of KNOWN_SQLITE_FILES) {
    const filePath = join(dbDir, name);
    if (!existsSync(filePath)) continue;
    if (!statSync(filePath).isFile()) {
      throw new Error(`数据库路径不是普通文件：${name}`);
    }
    seen.add(name);
    files.push(filePath);
  }
  for (const entry of readdirSync(dbDir, { withFileTypes: true })) {
    if (!entry.name.endsWith(".sqlite") || seen.has(entry.name)) continue;
    if (!entry.isFile()) {
      throw new Error(`数据库路径不是普通文件：${entry.name}`);
    }
    seen.add(entry.name);
    files.push(join(dbDir, entry.name));
  }
  return files;
}

/**
 * 对项目 SQLite 存储执行轻量只读探活（绝不创建文件或写入数据）。
 *
 * - 当 `db/` 下已有 `.sqlite` 文件时，逐个以只读模式打开并执行 `SELECT 1`。
 * - 当 `db/` 尚未创建或暂无 `.sqlite` 文件时，校验目录可读并验证 SQLite 运行时正常。
 */
export function checkStorageHealth(options?: StorageOptions): boolean {
  try {
    const rootDir = resolveProjectRoot(options?.rootDir);
    const dbDir = join(rootDir, DATABASE_DIRECTORY);

    if (existsSync(dbDir)) {
      if (!statSync(dbDir).isDirectory()) return false;
      accessSync(dbDir, constants.R_OK);
      const files = collectSqliteFiles(dbDir);
      if (files.length > 0) {
        return files.every((filePath) => probeSqliteFile(filePath));
      }
      return probeInMemorySqlite();
    }

    accessSync(rootDir, constants.R_OK);
    return probeInMemorySqlite();
  } catch {
    return false;
  }
}
