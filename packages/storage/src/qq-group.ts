import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QQ_GROUP_FILE } from "@nana/constants";
import { resolveDbPath } from "./paths.ts";
import type { StorageOptions } from "./types.ts";

export interface DiscoveredQQGroup {
  accountId: string;
  appId: string;
  openid: string;
  lastSeenAt: string;
}

function openDatabase(options?: StorageOptions) {
  const file = resolveDbPath(QQ_GROUP_FILE, options);
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS qq_group (
      account_id TEXT NOT NULL, app_id TEXT NOT NULL, openid TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      PRIMARY KEY (account_id, openid)
    ) STRICT;`);
  return db;
}

/** 换绑机器人后清理旧应用发现的候选，避免跨应用套用 openid。 */
export function prepareQQGroupDiscovery(
  accountId: string,
  appId: string,
  options?: StorageOptions,
): void {
  const db = openDatabase(options);
  try {
    db.prepare("DELETE FROM qq_group WHERE account_id = ? AND app_id <> ?").run(accountId, appId);
  } finally {
    db.close();
  }
}

export function recordDiscoveredQQGroup(group: DiscoveredQQGroup, options?: StorageOptions): void {
  const db = openDatabase(options);
  try {
    db.prepare(`INSERT INTO qq_group (account_id, app_id, openid, last_seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, openid) DO UPDATE SET app_id = excluded.app_id, last_seen_at = excluded.last_seen_at`).run(
      group.accountId,
      group.appId,
      group.openid,
      group.lastSeenAt,
    );
  } finally {
    db.close();
  }
}

export function readDiscoveredQQGroups(
  accountId: string,
  options?: StorageOptions,
): DiscoveredQQGroup[] {
  const db = openDatabase(options);
  try {
    return db
      .prepare(`SELECT account_id AS accountId, app_id AS appId, openid, last_seen_at AS lastSeenAt
      FROM qq_group WHERE account_id = ? ORDER BY last_seen_at DESC LIMIT 200`)
      .all(accountId) as unknown as DiscoveredQQGroup[];
  } finally {
    db.close();
  }
}
