import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DANMU_FILE } from "@nana/constants";
import type {
  DanmuMessage,
  DanmuMessageInput,
  DanmuSession,
  DanmuSessionCloseReason,
  DanmuSessionWithStats,
  StorageOptions,
} from "./types.ts";
import { resolveDbPath } from "./paths.ts";

/** 开启一场弹幕记录所需的入参。 */
export interface OpenDanmuSessionInput {
  /** 直播间号。 */
  roomId: number;
  /** 主播名。 */
  streamer: string;
  /** 开播时间（ISO 字符串），缺省取当前时间。 */
  startedAt?: string;
}

/** 结束一场弹幕记录所需的入参。 */
export interface CloseDanmuSessionInput {
  /** 结束时间（ISO 字符串），缺省取当前时间。 */
  endedAt?: string;
  /** 结束原因。 */
  reason: DanmuSessionCloseReason;
}

function openDanmuDatabase(options?: StorageOptions): DatabaseSync {
  const filePath = resolveDbPath(DANMU_FILE, options);
  mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS danmu_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      streamer TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      close_reason TEXT,
      msg_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS danmu_message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL
    ) STRICT;
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_danmu_message_session ON danmu_message(session_id);
  `);
  ensureDanmuSessionColumns(database);

  return database;
}

function ensureDanmuSessionColumns(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(danmu_session)").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );

  const migration: Record<string, string> = {
    ended_at: "ended_at TEXT",
    close_reason: "close_reason TEXT",
    msg_count: "msg_count INTEGER NOT NULL DEFAULT 0",
  };

  for (const [name, definition] of Object.entries(migration)) {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE danmu_session ADD COLUMN ${definition};`);
    }
  }
}

function mapDanmuSessionRow(row: Record<string, unknown>): DanmuSession {
  return {
    id: Number(row.id),
    roomId: String(row.room_id),
    streamer: String(row.streamer),
    startedAt: String(row.started_at),
    endedAt: row.ended_at == null ? null : (row.ended_at as string),
    closeReason: row.close_reason == null ? null : (row.close_reason as DanmuSessionCloseReason),
    msgCount: Number(row.msg_count),
  };
}

function mapDanmuMessageRow(row: Record<string, unknown>): DanmuMessage {
  return {
    id: Number(row.id),
    sessionId: Number(row.session_id),
    sentAt: String(row.sent_at),
    userId: String(row.user_id),
    username: String(row.username),
    content: String(row.content),
  };
}

function mapDanmuSessionWithStatsRow(row: Record<string, unknown>): DanmuSessionWithStats {
  return {
    ...mapDanmuSessionRow(row),
    participantCount: Number(row.participant_count),
  };
}

/** 结束场次用的 SQL 片段：只结束仍未结束的场次，保证幂等。 */
const CLOSE_UNFINISHED_SQL = `
  UPDATE danmu_session
  SET ended_at = ?, close_reason = ?
  WHERE ended_at IS NULL
`;

/**
 * 开启一场弹幕记录。
 *
 * 会先把该直播间所有仍未结束（`ended_at IS NULL`）的残留场次以 `close_reason = "stale"`
 * 收尾（例如进程异常退出、漏收下播事件），再插入新场次并返回。
 */
export function openDanmuSession(
  input: OpenDanmuSessionInput,
  options?: StorageOptions,
): DanmuSession {
  const database = openDanmuDatabase(options);
  const startedAt = input.startedAt ?? new Date().toISOString();

  try {
    database.exec("BEGIN");

    try {
      database
        .prepare(
          `UPDATE danmu_session SET ended_at = ?, close_reason = ? WHERE room_id = ? AND ended_at IS NULL`,
        )
        .run(startedAt, "stale" satisfies DanmuSessionCloseReason, String(input.roomId));

      const result = database
        .prepare(`
          INSERT INTO danmu_session (room_id, streamer, started_at, ended_at, close_reason, msg_count)
          VALUES (?, ?, ?, NULL, NULL, 0)
        `)
        .run(String(input.roomId), input.streamer, startedAt);

      const id = Number(result.lastInsertRowid);

      database.exec("COMMIT");

      return {
        id,
        roomId: String(input.roomId),
        streamer: input.streamer,
        startedAt,
        endedAt: null,
        closeReason: null,
        msgCount: 0,
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

/** 查找某直播间当前仍在进行中的场次；没有时返回 undefined。 */
export function findActiveDanmuSession(
  roomId: number,
  options?: StorageOptions,
): DanmuSession | undefined {
  const database = openDanmuDatabase(options);

  try {
    const row = database
      .prepare(`
        SELECT id, room_id, streamer, started_at, ended_at, close_reason, msg_count
        FROM danmu_session
        WHERE room_id = ? AND ended_at IS NULL
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(String(roomId)) as Record<string, unknown> | undefined;

    return row ? mapDanmuSessionRow(row) : undefined;
  } finally {
    database.close();
  }
}

/**
 * 批量追加弹幕，并在同一事务内累加 `danmu_session.msg_count`。
 *
 * 调用方负责自己做批合并；本函数同步执行，空数组时直接返回。
 */
export function appendDanmuMessages(
  sessionId: number,
  messages: readonly DanmuMessageInput[],
  options?: StorageOptions,
): void {
  if (messages.length === 0) {
    return;
  }

  const database = openDanmuDatabase(options);

  try {
    database.exec("BEGIN");

    try {
      const insert = database.prepare(`
        INSERT INTO danmu_message (session_id, sent_at, user_id, username, content)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const message of messages) {
        insert.run(sessionId, message.sentAt, message.userId, message.username, message.content);
      }

      database
        .prepare("UPDATE danmu_session SET msg_count = msg_count + ? WHERE id = ?")
        .run(messages.length, sessionId);

      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

/**
 * 结束一场弹幕记录。
 *
 * 幂等：已结束的场次不会被再次改写，返回该场次当前的记录；场次不存在时返回 undefined。
 */
export function closeDanmuSession(
  id: number,
  input: CloseDanmuSessionInput,
  options?: StorageOptions,
): DanmuSession | undefined {
  const database = openDanmuDatabase(options);
  const endedAt = input.endedAt ?? new Date().toISOString();

  try {
    database.prepare(`${CLOSE_UNFINISHED_SQL} AND id = ?`).run(endedAt, input.reason, id);

    const row = database
      .prepare(`
        SELECT id, room_id, streamer, started_at, ended_at, close_reason, msg_count
        FROM danmu_session
        WHERE id = ?
      `)
      .get(id) as Record<string, unknown> | undefined;

    return row ? mapDanmuSessionRow(row) : undefined;
  } finally {
    database.close();
  }
}

/** 列出历史场次（含参与人数），按开始时间倒序。 */
export function listDanmuSessions(options?: StorageOptions, limit = 20): DanmuSessionWithStats[] {
  const database = openDanmuDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT
          s.id, s.room_id, s.streamer, s.started_at, s.ended_at, s.close_reason, s.msg_count,
          (SELECT COUNT(DISTINCT
             CASE WHEN m.user_id = '0' THEN m.user_id || char(0) || m.username ELSE m.user_id END
           ) FROM danmu_message m WHERE m.session_id = s.id)
            AS participant_count
        FROM danmu_session s
        ORDER BY s.started_at DESC, s.id DESC
        LIMIT ?
      `)
      .all(limit) as Record<string, unknown>[];

    return rows.map(mapDanmuSessionWithStatsRow);
  } finally {
    database.close();
  }
}

/** 读取单个场次；不存在时返回 undefined。 */
export function readDanmuSession(id: number, options?: StorageOptions): DanmuSession | undefined {
  const database = openDanmuDatabase(options);

  try {
    const row = database
      .prepare(`
        SELECT id, room_id, streamer, started_at, ended_at, close_reason, msg_count
        FROM danmu_session
        WHERE id = ?
      `)
      .get(id) as Record<string, unknown> | undefined;

    return row ? mapDanmuSessionRow(row) : undefined;
  } finally {
    database.close();
  }
}

/** 读取某场次的全部弹幕，按发送时间与写入顺序升序。 */
export function readDanmuMessages(sessionId: number, options?: StorageOptions): DanmuMessage[] {
  const database = openDanmuDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT id, session_id, sent_at, user_id, username, content
        FROM danmu_message
        WHERE session_id = ?
        ORDER BY sent_at ASC, id ASC
      `)
      .all(sessionId) as Record<string, unknown>[];

    return rows.map(mapDanmuMessageRow);
  } finally {
    database.close();
  }
}
