import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LIVE_STATUS_FILE } from "@nana/constants";
import type { LiveStatus, StorageOptions } from "./types.ts";
import { resolveDbPath } from "./paths.ts";

function openLiveStatusDatabase(options?: StorageOptions): DatabaseSync {
  const filePath = resolveDbPath(LIVE_STATUS_FILE, options);
  mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS live_status (
      room_id TEXT PRIMARY KEY,
      streamer TEXT NOT NULL,
      live INTEGER NOT NULL CHECK (live IN (0, 1)),
      updated_at TEXT NOT NULL,
      title TEXT,
      area TEXT,
      viewer INTEGER
    ) STRICT;
  `);
  ensureLiveStatusColumns(database);

  return database;
}

function ensureLiveStatusColumns(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(live_status)").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );

  const migration: Record<string, string> = {
    title: "title TEXT",
    area: "area TEXT",
    viewer: "viewer INTEGER",
  };

  for (const [name, definition] of Object.entries(migration)) {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE live_status ADD COLUMN ${definition};`);
    }
  }
}

function mapLiveStatusRow(row: Record<string, unknown>): LiveStatus {
  return {
    streamer: String(row.streamer),
    live: Number(row.live) === 1,
    updatedAt: String(row.updated_at),
    title: row.title == null ? null : (row.title as string),
    area: row.area == null ? null : (row.area as string),
    viewer: row.viewer == null ? null : Number(row.viewer),
  };
}

export interface LiveStatusRecord extends LiveStatus {
  /** 直播间号（字符串形式，与 SQLite 主键一致）。 */
  roomId: string;
  title: string | null;
  area: string | null;
  viewer: number | null;
}

function mapLiveStatusRecord(row: Record<string, unknown>): LiveStatusRecord {
  return {
    roomId: String(row.room_id),
    streamer: String(row.streamer),
    live: Number(row.live) === 1,
    updatedAt: String(row.updated_at),
    title: row.title == null ? null : (row.title as string),
    area: row.area == null ? null : (row.area as string),
    viewer: row.viewer == null ? null : Number(row.viewer),
  };
}

export function writeLiveStatus(
  roomId: number,
  status: LiveStatus,
  options?: StorageOptions,
): void {
  const database = openLiveStatusDatabase(options);

  try {
    database
      .prepare(`
        INSERT INTO live_status (room_id, streamer, live, updated_at, title, area, viewer)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          streamer = excluded.streamer,
          live = excluded.live,
          updated_at = excluded.updated_at,
          title = excluded.title,
          area = excluded.area,
          viewer = excluded.viewer
      `)
      .run(
        String(roomId),
        status.streamer,
        status.live ? 1 : 0,
        status.updatedAt,
        status.title ?? null,
        status.area ?? null,
        status.viewer ?? null,
      );
  } finally {
    database.close();
  }
}

export function readLiveStatus(roomId: number, options?: StorageOptions): LiveStatus | undefined {
  const database = openLiveStatusDatabase(options);

  try {
    const row = database
      .prepare(`
        SELECT streamer, live, updated_at, title, area, viewer
        FROM live_status
        WHERE room_id = ?
      `)
      .get(String(roomId));

    return row ? mapLiveStatusRow(row) : undefined;
  } finally {
    database.close();
  }
}

/** 读取全部主播的直播状态，按更新时间倒序。 */
export function readAllLiveStatus(options?: StorageOptions): LiveStatusRecord[] {
  const database = openLiveStatusDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT room_id, streamer, live, updated_at, title, area, viewer
        FROM live_status
        ORDER BY updated_at DESC
      `)
      .all() as Record<string, unknown>[];

    return rows.map(mapLiveStatusRecord);
  } finally {
    database.close();
  }
}
