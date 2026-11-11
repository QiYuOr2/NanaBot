import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_STATE_FILE } from "@nana/constants";
import type { AppStateOptions } from "./types.ts";
import { resolveDbPath } from "./paths.ts";

/** 应用自身的持久化状态（机器人在线/离线告警状态机）。 */
export interface AppState {
  /** 是否为在线状态。 */
  online: boolean;
  /** 已连续检测到离线的次数。 */
  offlineCount: number;
  /** 本段离线开始时间（ISO 字符串），在线时为 null。 */
  offlineSince: string | null;
  /** 最近一次离线告警时间（ISO 字符串）。 */
  lastOfflineAlertAt: string | null;
  /** 最近一次恢复告警时间（ISO 字符串）。 */
  lastOnlineAlertAt: string | null;
}

function openAppStateDatabase(options?: AppStateOptions): DatabaseSync {
  const filePath = resolveDbPath(appStateFile(options?.accountId), options);
  mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      online INTEGER NOT NULL CHECK (online IN (0, 1)),
      offline_count INTEGER NOT NULL DEFAULT 0,
      offline_since TEXT,
      last_offline_alert_at TEXT,
      last_online_alert_at TEXT
    ) STRICT;
  `);

  return database;
}

/** 默认账号沿用旧文件，保证站点当前状态与历史数据不中断。 */
function appStateFile(accountId: string | undefined): string {
  if (!accountId) {
    return APP_STATE_FILE;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) {
    throw new Error("账号 id 只能包含字母、数字、下划线和短横线。");
  }
  return `app-state-${accountId}.sqlite`;
}

function mapAppStateRow(row: Record<string, unknown>): AppState {
  return {
    online: Number(row.online) === 1,
    offlineCount: Number(row.offline_count),
    offlineSince: row.offline_since == null ? null : (row.offline_since as string),
    lastOfflineAlertAt:
      row.last_offline_alert_at == null ? null : (row.last_offline_alert_at as string),
    lastOnlineAlertAt:
      row.last_online_alert_at == null ? null : (row.last_online_alert_at as string),
  };
}

/** 读取应用状态；无记录时返回 undefined。 */
export function readAppState(options?: AppStateOptions): AppState | undefined {
  const database = openAppStateDatabase(options);

  try {
    const row = database
      .prepare(`
        SELECT online, offline_count, offline_since, last_offline_alert_at, last_online_alert_at
        FROM app_state
        WHERE id = 1
      `)
      .get() as Record<string, unknown> | undefined;

    return row ? mapAppStateRow(row) : undefined;
  } finally {
    database.close();
  }
}

/** 写入（或覆盖）应用状态。 */
export function writeAppState(state: AppState, options?: AppStateOptions): void {
  const database = openAppStateDatabase(options);

  try {
    database
      .prepare(`
        INSERT INTO app_state
          (id, online, offline_count, offline_since, last_offline_alert_at, last_online_alert_at)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          online = excluded.online,
          offline_count = excluded.offline_count,
          offline_since = excluded.offline_since,
          last_offline_alert_at = excluded.last_offline_alert_at,
          last_online_alert_at = excluded.last_online_alert_at
      `)
      .run(
        state.online ? 1 : 0,
        state.offlineCount,
        state.offlineSince,
        state.lastOfflineAlertAt,
        state.lastOnlineAlertAt,
      );
  } finally {
    database.close();
  }
}
