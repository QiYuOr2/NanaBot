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
      updated_at TEXT NOT NULL
    ) STRICT;
  `);

  return database;
}

function mapLiveStatusRow(row: Record<string, unknown>): LiveStatus {
  return {
    streamer: String(row.streamer),
    live: Number(row.live) === 1,
    updatedAt: String(row.updated_at),
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
        INSERT INTO live_status (room_id, streamer, live, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          streamer = excluded.streamer,
          live = excluded.live,
          updated_at = excluded.updated_at
      `)
      .run(String(roomId), status.streamer, status.live ? 1 : 0, status.updatedAt);
  } finally {
    database.close();
  }
}

export function readLiveStatus(roomId: number, options?: StorageOptions): LiveStatus | undefined {
  const database = openLiveStatusDatabase(options);

  try {
    const row = database
      .prepare(`
        SELECT streamer, live, updated_at
        FROM live_status
        WHERE room_id = ?
      `)
      .get(String(roomId));

    return row ? mapLiveStatusRow(row) : undefined;
  } finally {
    database.close();
  }
}
