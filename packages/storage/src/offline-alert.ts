import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_STATE_FILE } from "@nana/constants";
import type { StorageOptions } from "./types.ts";
import { resolveDbPath } from "./paths.ts";

/** 一次机器人离线或恢复告警。 */
export interface OfflineAlertRecord {
  id: number;
  kind: "offline" | "recovered";
  /** 本段离线开始时间（ISO 字符串）。 */
  offlineSince: string;
  /** 离线时长（毫秒），仅恢复告警有值。 */
  downtimeMs: number | null;
  /** 触发来源，如 heartbeat / socket.close / socket.open。 */
  reason: string | null;
  /** 告警写入时间（ISO 字符串）。 */
  createdAt: string;
}

export interface OfflineAlertInput {
  kind: OfflineAlertRecord["kind"];
  offlineSince: string;
  downtimeMs?: number;
  reason?: string;
  createdAt?: string;
}

const DEFAULT_ALERT_LIMIT = 100;

function openOfflineAlertDatabase(options?: StorageOptions): DatabaseSync {
  const filePath = resolveDbPath(APP_STATE_FILE, options);
  mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS offline_alert (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('offline', 'recovered')),
      offline_since TEXT NOT NULL,
      downtime_ms INTEGER,
      reason TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
  `);

  return database;
}

function mapOfflineAlertRow(row: Record<string, unknown>): OfflineAlertRecord {
  return {
    id: Number(row.id),
    kind: row.kind === "recovered" ? "recovered" : "offline",
    offlineSince: String(row.offline_since),
    downtimeMs: row.downtime_ms == null ? null : Number(row.downtime_ms),
    reason: row.reason == null ? null : (row.reason as string),
    createdAt: String(row.created_at),
  };
}

/** 追加一条离线或恢复告警，返回新记录的 id。 */
export function appendOfflineAlert(alert: OfflineAlertInput, options?: StorageOptions): number {
  const database = openOfflineAlertDatabase(options);

  try {
    const result = database
      .prepare(`
        INSERT INTO offline_alert (kind, offline_since, downtime_ms, reason, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        alert.kind,
        alert.offlineSince,
        alert.downtimeMs ?? null,
        alert.reason ?? null,
        alert.createdAt ?? new Date().toISOString(),
      );

    return Number(result.lastInsertRowid);
  } finally {
    database.close();
  }
}

/** 按写入时间从新到旧读取离线告警。 */
export function readOfflineAlerts(
  options?: StorageOptions,
  limit = DEFAULT_ALERT_LIMIT,
): OfflineAlertRecord[] {
  const database = openOfflineAlertDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT id, kind, offline_since, downtime_ms, reason, created_at
        FROM offline_alert
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit) as Record<string, unknown>[];

    return rows.map(mapOfflineAlertRow);
  } finally {
    database.close();
  }
}
