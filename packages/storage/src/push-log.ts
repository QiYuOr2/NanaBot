import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PUSH_LOG_FILE } from "@nana/constants";
import type { PushLog, PushLogPurpose, StorageOptions } from "./types.ts";
import { resolveDbPath } from "./paths.ts";

function openPushLogDatabase(options?: StorageOptions): DatabaseSync {
  const filePath = resolveDbPath(PUSH_LOG_FILE, options);
  mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS push_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT,
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
  ensureAccountColumn(database);

  return database;
}

/** 旧库的 `push_log` 没有 account 列；打开时补上，避免多账号上线后必须手工迁移。 */
function ensureAccountColumn(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(push_log)").all() as {
    name?: unknown;
  }[];
  if (!columns.some((column) => column.name === "account")) {
    database.exec("ALTER TABLE push_log ADD COLUMN account TEXT;");
  }
}

export interface PushLogRecord extends PushLog {
  id: number;
}

function mapPushLogRow(row: Record<string, unknown>): PushLogRecord {
  return {
    id: Number(row.id),
    account: row.account == null ? null : (row.account as string),
    targetId: String(row.target_id),
    target: String(row.target),
    purpose: row.purpose as PushLogPurpose,
    purposeLabel: String(row.purpose_label),
    pushedAt: String(row.pushed_at),
    success: Number(row.success) === 1,
    error: row.error == null ? null : (row.error as string),
    content: row.content == null ? null : (row.content as string),
    subject: row.subject == null ? null : (row.subject as string),
  };
}

/** 追加一条推送记录。 */
export function writePushLog(log: PushLog, options?: StorageOptions): void {
  const database = openPushLogDatabase(options);

  try {
    database
      .prepare(`
        INSERT INTO push_log
          (account, target_id, target, purpose, purpose_label, pushed_at, success, error, content, subject)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        log.account ?? null,
        log.targetId,
        log.target,
        log.purpose,
        log.purposeLabel,
        log.pushedAt,
        log.success ? 1 : 0,
        log.error ?? null,
        log.content ?? null,
        log.subject ?? null,
      );
  } finally {
    database.close();
  }
}

/** 读取最近的推送记录，按推送时间倒序。 */
export function readPushLogs(options?: StorageOptions, limit = 20): PushLogRecord[] {
  const database = openPushLogDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT id, account, target_id, target, purpose, purpose_label, pushed_at, success, error, content, subject
        FROM push_log
        ORDER BY pushed_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as Record<string, unknown>[];

    return rows.map(mapPushLogRow);
  } finally {
    database.close();
  }
}
