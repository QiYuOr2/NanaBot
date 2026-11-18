import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DYNAMIC_FILE } from "@nana/constants";
import type {
  DynamicItemRecord,
  DynamicPushStatus,
  DynamicMonitorState,
  NewDynamicItem,
  StorageOptions,
} from "./types.ts";
import { resolveDbPath } from "./paths.ts";

function openDynamicDatabase(options?: StorageOptions): DatabaseSync {
  const filePath = resolveDbPath(DYNAMIC_FILE, options);
  mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_item (
      dynamic_id TEXT PRIMARY KEY,
      uid INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      content TEXT,
      url TEXT NOT NULL,
      cover_url TEXT,
      image_urls TEXT,
      author_name TEXT,
      published_at TEXT,
      discovered_at TEXT NOT NULL,
      push_status TEXT NOT NULL CHECK (push_status IN ('bootstrap','pending','success','failed','skipped')),
      pushed_at TEXT,
      last_error TEXT
    ) STRICT;
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_dynamic_item_uid ON dynamic_item(uid, discovered_at);
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_dynamic_item_status ON dynamic_item(push_status, discovered_at);
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_monitor_state (
      uid INTEGER PRIMARY KEY,
      initialized INTEGER NOT NULL CHECK (initialized IN (0, 1)),
      last_dynamic_id TEXT,
      last_checked_at TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  ensureDynamicItemColumns(database);

  return database;
}

/** 旧库缺 author_name 列时补齐（幂等）。 */
function ensureDynamicItemColumns(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(dynamic_item)").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  if (!columns.has("author_name")) {
    database.exec("ALTER TABLE dynamic_item ADD COLUMN author_name TEXT;");
  }
}

function mapItemRow(row: Record<string, unknown>): DynamicItemRecord {
  return {
    dynamicId: String(row.dynamic_id),
    uid: Number(row.uid),
    type: String(row.type),
    title: row.title == null ? null : String(row.title),
    content: row.content == null ? null : String(row.content),
    url: String(row.url),
    coverUrl: row.cover_url == null ? null : String(row.cover_url),
    imageUrls: parseImageUrls(row.image_urls),
    authorName: row.author_name == null ? null : String(row.author_name),
    publishedAt: row.published_at == null ? null : String(row.published_at),
    discoveredAt: String(row.discovered_at),
    pushStatus: row.push_status as DynamicPushStatus,
    pushedAt: row.pushed_at == null ? null : String(row.pushed_at),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

function parseImageUrls(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((url): url is string => typeof url === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * 在一个事务里写入一批新发现的动态，并把该 UID 的游标推进到 `lastDynamicId`。
 *
 * - 使用 `INSERT OR IGNORE` 保证 dynamic_id 唯一，重复轮询不会重复入队。
 * - `pushStatus` 决定新动态是否可直接推送：bootstrap 阶段写入 `bootstrap`（不推送），
 *   正常轮询写入 `pending`。
 * - 游标只在本次事务提交时推进；调用方必须在请求成功后才调用本函数。
 *
 * 返回本次真正新插入的动态数量（已存在的计入 0）。
 */
export function recordDiscoveredDynamics(input: {
  uid: number;
  items: readonly NewDynamicItem[];
  pushStatus: Extract<DynamicPushStatus, "bootstrap" | "pending">;
  lastDynamicId: string | null;
  discoveredAt: string;
  initialized: boolean;
  options?: StorageOptions;
}): number {
  const database = openDynamicDatabase(input.options);
  try {
    database.exec("BEGIN IMMEDIATE;");
    let inserted = 0;
    const insert = database.prepare(`
      INSERT OR IGNORE INTO dynamic_item
        (dynamic_id, uid, type, title, content, url, cover_url, image_urls, author_name,
         published_at, discovered_at, push_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of input.items) {
      const result = insert.run(
        item.dynamicId,
        item.uid,
        item.type,
        item.title ?? null,
        item.content ?? null,
        item.url,
        item.coverUrl ?? null,
        JSON.stringify(item.imageUrls ?? []),
        item.authorName ?? null,
        item.publishedAt ?? null,
        input.discoveredAt,
        input.pushStatus,
      );
      inserted += Number(result.changes ?? 0);
    }
    upsertMonitorState(database, {
      uid: input.uid,
      initialized: input.initialized,
      lastDynamicId: input.lastDynamicId,
      lastCheckedAt: input.discoveredAt,
      updatedAt: input.discoveredAt,
    });
    database.exec("COMMIT;");
    return inserted;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  } finally {
    database.close();
  }
}

/** 仅记录一次成功的检查（无新动态时用来推进 last_checked_at，不改变游标）。 */
export function touchMonitorCheck(input: {
  uid: number;
  checkedAt: string;
  options?: StorageOptions;
}): void {
  const database = openDynamicDatabase(input.options);
  try {
    const existing = readMonitorStateWith(database, input.uid);
    upsertMonitorState(database, {
      uid: input.uid,
      initialized: existing?.initialized ?? false,
      lastDynamicId: existing?.lastDynamicId ?? null,
      lastCheckedAt: input.checkedAt,
      updatedAt: input.checkedAt,
    });
  } finally {
    database.close();
  }
}

function upsertMonitorState(database: DatabaseSync, state: DynamicMonitorState): void {
  database
    .prepare(`
      INSERT INTO dynamic_monitor_state (uid, initialized, last_dynamic_id, last_checked_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        initialized = excluded.initialized,
        last_dynamic_id = excluded.last_dynamic_id,
        last_checked_at = excluded.last_checked_at,
        updated_at = excluded.updated_at
    `)
    .run(
      state.uid,
      state.initialized ? 1 : 0,
      state.lastDynamicId,
      state.lastCheckedAt,
      state.updatedAt,
    );
}

function readMonitorStateWith(
  database: DatabaseSync,
  uid: number,
): DynamicMonitorState | undefined {
  const row = database
    .prepare(`
      SELECT uid, initialized, last_dynamic_id, last_checked_at, updated_at
      FROM dynamic_monitor_state WHERE uid = ?
    `)
    .get(uid) as Record<string, unknown> | undefined;
  return row ? mapStateRow(row) : undefined;
}

function mapStateRow(row: Record<string, unknown>): DynamicMonitorState {
  return {
    uid: Number(row.uid),
    initialized: Number(row.initialized) === 1,
    lastDynamicId: row.last_dynamic_id == null ? null : String(row.last_dynamic_id),
    lastCheckedAt: row.last_checked_at == null ? null : String(row.last_checked_at),
    updatedAt: String(row.updated_at),
  };
}

/** 读取某 UID 的监控状态；不存在时返回 undefined。 */
export function readDynamicMonitorState(
  uid: number,
  options?: StorageOptions,
): DynamicMonitorState | undefined {
  const database = openDynamicDatabase(options);
  try {
    return readMonitorStateWith(database, uid);
  } finally {
    database.close();
  }
}

/** 列出所有处于 pending 的动态（重启恢复用），按发现时间升序。 */
export function listPendingDynamics(options?: StorageOptions): DynamicItemRecord[] {
  const database = openDynamicDatabase(options);
  try {
    const rows = database
      .prepare(`
        SELECT * FROM dynamic_item WHERE push_status = 'pending' ORDER BY discovered_at ASC
      `)
      .all() as Record<string, unknown>[];
    return rows.map(mapItemRow);
  } finally {
    database.close();
  }
}

/** 该动态是否已存在（用于入队去重判断）。 */
export function hasDynamicItem(dynamicId: string, options?: StorageOptions): boolean {
  const database = openDynamicDatabase(options);
  try {
    const row = database
      .prepare("SELECT 1 AS present FROM dynamic_item WHERE dynamic_id = ?")
      .get(dynamicId);
    return Boolean(row);
  } finally {
    database.close();
  }
}

/** 标记一条动态为发送成功。 */
export function markDynamicSuccess(input: {
  dynamicId: string;
  pushedAt: string;
  options?: StorageOptions;
}): void {
  updatePushStatus(input.dynamicId, "success", input.pushedAt, null, input.options);
}

/** 标记一条动态发送失败，记录错误并保留可重试状态（仍为 pending）。 */
export function markDynamicFailed(input: {
  dynamicId: string;
  error: string;
  options?: StorageOptions;
}): void {
  updatePushStatus(input.dynamicId, "pending", null, input.error, input.options);
}

/** 标记一条动态为跳过（例如类型过滤或账号不可用）。 */
export function markDynamicSkipped(input: {
  dynamicId: string;
  reason?: string;
  options?: StorageOptions;
}): void {
  updatePushStatus(input.dynamicId, "skipped", null, input.reason ?? null, input.options);
}

function updatePushStatus(
  dynamicId: string,
  status: DynamicPushStatus,
  pushedAt: string | null,
  lastError: string | null,
  options?: StorageOptions,
): void {
  const database = openDynamicDatabase(options);
  try {
    database
      .prepare(`
        UPDATE dynamic_item
        SET push_status = ?, pushed_at = COALESCE(?, pushed_at), last_error = ?
        WHERE dynamic_id = ?
      `)
      .run(status, pushedAt, lastError, dynamicId);
  } finally {
    database.close();
  }
}

/** 读取一条动态记录（测试与排查用）。 */
export function readDynamicItem(
  dynamicId: string,
  options?: StorageOptions,
): DynamicItemRecord | undefined {
  const database = openDynamicDatabase(options);
  try {
    const row = database
      .prepare("SELECT * FROM dynamic_item WHERE dynamic_id = ?")
      .get(dynamicId) as Record<string, unknown> | undefined;
    return row ? mapItemRow(row) : undefined;
  } finally {
    database.close();
  }
}
