import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DANMU_FILE } from "@nana/constants";
import type {
  ClaimLiveSummaryResult,
  CompleteLiveSummaryInput,
  DanmuMessage,
  DanmuMessageInput,
  DanmuSession,
  DanmuSessionCloseReason,
  DanmuSessionCutOff,
  DanmuSessionWithStats,
  LiveSummaryRecord,
  LiveSummarySource,
  LiveSummaryStatus,
  StorageOptions,
  StoredLiveSummary,
  UnpushedLiveSummary,
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

/** 记录一次超管切断所需的入参。 */
export interface RecordDanmuSessionCutOffInput {
  /** 关联的弹幕场次 ID；无活跃场次时为 null。 */
  sessionId?: number | null;
  /** 直播间号。 */
  roomId: number;
  /** 主播名。 */
  streamer: string;
  /** 切断时间（ISO 字符串），缺省取当前时间。 */
  cutOffAt?: string;
  /** B 站返回的切断原因，缺省为空字符串。 */
  reason?: string;
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
  database.exec(`
    CREATE TABLE IF NOT EXISTS danmu_session_cutoff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      room_id TEXT NOT NULL,
      streamer TEXT NOT NULL,
      cut_off_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    ) STRICT;
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_danmu_session_cutoff_session ON danmu_session_cutoff(session_id);
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_danmu_session_cutoff_room ON danmu_session_cutoff(room_id, cut_off_at);
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
    live_summary: "live_summary TEXT",
    live_summary_status: "live_summary_status TEXT",
    live_summary_source: "live_summary_source TEXT",
    live_summary_pushed: "live_summary_pushed INTEGER NOT NULL DEFAULT 0",
    live_summary_claimed_at: "live_summary_claimed_at TEXT",
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
    cutOffCount: Number(row.cut_off_count ?? 0),
  };
}

function mapDanmuSessionCutOffRow(row: Record<string, unknown>): DanmuSessionCutOff {
  return {
    id: Number(row.id),
    sessionId: row.session_id == null ? null : Number(row.session_id),
    roomId: String(row.room_id),
    streamer: String(row.streamer),
    cutOffAt: String(row.cut_off_at),
    reason: row.reason == null ? "" : (row.reason as string),
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

/** 列出历史场次（含参与人数与超管切断次数），按开始时间倒序。 */
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
            AS participant_count,
          (SELECT COUNT(*) FROM danmu_session_cutoff c WHERE c.session_id = s.id)
            AS cut_off_count
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

/** 记录一次超管切断事件。 */
export function recordDanmuSessionCutOff(
  input: RecordDanmuSessionCutOffInput,
  options?: StorageOptions,
): DanmuSessionCutOff {
  const database = openDanmuDatabase(options);
  const cutOffAt = input.cutOffAt ?? new Date().toISOString();
  const reason = input.reason?.trim() ?? "";
  const sessionId = input.sessionId ?? null;

  try {
    const result = database
      .prepare(`
        INSERT INTO danmu_session_cutoff (session_id, room_id, streamer, cut_off_at, reason)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(sessionId, String(input.roomId), input.streamer, cutOffAt, reason);

    return {
      id: Number(result.lastInsertRowid),
      sessionId,
      roomId: String(input.roomId),
      streamer: input.streamer,
      cutOffAt,
      reason,
    };
  } finally {
    database.close();
  }
}

/** 读取某场次的全部超管切断记录，按发生时间升序。 */
export function readDanmuSessionCutOffs(
  sessionId: number,
  options?: StorageOptions,
): DanmuSessionCutOff[] {
  const database = openDanmuDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT id, session_id, room_id, streamer, cut_off_at, reason
        FROM danmu_session_cutoff
        WHERE session_id = ?
        ORDER BY cut_off_at ASC, id ASC
      `)
      .all(sessionId) as Record<string, unknown>[];

    return rows.map(mapDanmuSessionCutOffRow);
  } finally {
    database.close();
  }
}

/** 读取每个直播间最近一次超管切断记录。 */
export function readLatestCutOffByRooms(options?: StorageOptions): DanmuSessionCutOff[] {
  const database = openDanmuDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT id, session_id, room_id, streamer, cut_off_at, reason
        FROM (
          SELECT
            id, session_id, room_id, streamer, cut_off_at, reason,
            ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY cut_off_at DESC, id DESC) AS rn
          FROM danmu_session_cutoff
        )
        WHERE rn = 1
      `)
      .all() as Record<string, unknown>[];

    return rows.map(mapDanmuSessionCutOffRow);
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

/** 认领超过该时间仍停在 `pending` 的写入权可以被下一次调用接走。 */
export const LIVE_SUMMARY_CLAIM_STALE_MS = 120_000;

const KNOWN_SUMMARY_STATUSES = new Set<LiveSummaryStatus>(["pending", "ok", "empty", "failed"]);

function parseLiveSummaryStatus(value: unknown): LiveSummaryStatus | null {
  return typeof value === "string" && KNOWN_SUMMARY_STATUSES.has(value as LiveSummaryStatus)
    ? (value as LiveSummaryStatus)
    : null;
}

function parseLiveSummarySource(value: unknown): LiveSummarySource | null {
  return value === "bot" || value === "site" ? value : null;
}

function mapLiveSummaryRow(row: Record<string, unknown>): StoredLiveSummary {
  return {
    status: parseLiveSummaryStatus(row.live_summary_status),
    text: row.live_summary == null ? null : (row.live_summary as string),
    source: parseLiveSummarySource(row.live_summary_source),
    pushed: Number(row.live_summary_pushed) === 1,
    ended: row.ended_at != null,
  };
}

function toLiveSummaryRecord(summary: StoredLiveSummary): LiveSummaryRecord {
  return {
    status: summary.status,
    text: summary.text,
    source: summary.source,
    pushed: summary.pushed,
  };
}

/** 读取一场的直播摘要。场次不存在时返回 undefined。 */
export function readLiveSummary(
  sessionId: number,
  options?: StorageOptions,
): StoredLiveSummary | undefined {
  const database = openDanmuDatabase(options);

  try {
    const row = database
      .prepare(`
        SELECT ended_at, live_summary, live_summary_status, live_summary_source, live_summary_pushed
        FROM danmu_session
        WHERE id = ?
      `)
      .get(sessionId) as Record<string, unknown> | undefined;

    return row ? mapLiveSummaryRow(row) : undefined;
  } finally {
    database.close();
  }
}

/**
 * 认领一场摘要的写入权。
 *
 * 已有 `ok` / `empty` 时默认直接返回现有结果，不再生成；`force` 为 true 时允许覆盖重算。
 * 进行中的场次不能认领。
 * 两个调用同时认领时只有一个得到 `claimed`。
 */
export function claimLiveSummary(
  sessionId: number,
  options?: StorageOptions & { now?: Date; staleMs?: number; force?: boolean },
): ClaimLiveSummaryResult {
  const now = options?.now ?? new Date();
  const force = options?.force === true;
  const claimedAt = now.toISOString();
  const staleBefore = new Date(
    now.getTime() - (options?.staleMs ?? LIVE_SUMMARY_CLAIM_STALE_MS),
  ).toISOString();
  const database = openDanmuDatabase(options);

  try {
    const current = readLiveSummaryRow(database, sessionId);
    if (!current) {
      return { kind: "missing" };
    }
    if (!current.ended) {
      return { kind: "active" };
    }
    if (!force && (current.status === "ok" || current.status === "empty")) {
      return { kind: "existing", summary: toLiveSummaryRecord(current) };
    }
    if (
      current.status === "pending" &&
      current.claimedAt !== null &&
      current.claimedAt >= staleBefore
    ) {
      return { kind: "busy" };
    }

    const result = database
      .prepare(`
        UPDATE danmu_session
        SET live_summary_status = 'pending', live_summary_claimed_at = ?
        WHERE id = ?
          AND ended_at IS NOT NULL
          AND (
            live_summary_status IS NULL
            OR live_summary_status = 'failed'
            OR live_summary_status NOT IN ('pending', 'ok', 'empty', 'failed')
            OR (
              live_summary_status = 'pending'
              AND (live_summary_claimed_at IS NULL OR live_summary_claimed_at < ?)
            )
            OR (? = 1 AND live_summary_status IN ('ok', 'empty'))
          )
      `)
      .run(claimedAt, sessionId, staleBefore, force ? 1 : 0);

    if (Number(result.changes) !== 1) {
      const latest = readLiveSummaryRow(database, sessionId);
      if (!latest) {
        return { kind: "missing" };
      }
      if (!latest.ended) {
        return { kind: "active" };
      }
      if (!force && (latest.status === "ok" || latest.status === "empty")) {
        return { kind: "existing", summary: toLiveSummaryRecord(latest) };
      }
      return { kind: "busy" };
    }

    return { kind: "claimed", claimedAt };
  } finally {
    database.close();
  }
}

/**
 * 用认领时的 `claimedAt` 写入最终摘要。
 *
 * 认领权已被别人接走时返回 false，调用方必须丢掉这次结果，避免覆盖后写入的正文。
 */
export function completeLiveSummary(
  sessionId: number,
  claimedAt: string,
  input: CompleteLiveSummaryInput,
  options?: StorageOptions,
): boolean {
  const database = openDanmuDatabase(options);

  try {
    const result = database
      .prepare(`
        UPDATE danmu_session
        SET live_summary_status = ?,
            live_summary = ?,
            live_summary_source = ?,
            live_summary_pushed = 0,
            live_summary_claimed_at = NULL
        WHERE id = ?
          AND live_summary_status = 'pending'
          AND live_summary_claimed_at = ?
      `)
      .run(input.status, input.text, input.source, sessionId, claimedAt);

    return Number(result.changes) === 1;
  } finally {
    database.close();
  }
}

/** 标记机器人侧的群推送已结束，启动补偿不会再发这一场。 */
export function markLiveSummaryPushed(sessionId: number, options?: StorageOptions): void {
  const database = openDanmuDatabase(options);

  try {
    database
      .prepare(`
        UPDATE danmu_session
        SET live_summary_pushed = 1
        WHERE id = ?
          AND live_summary_source = 'bot'
          AND live_summary_status = 'ok'
      `)
      .run(sessionId);
  } finally {
    database.close();
  }
}

/** 列出机器人已写好、但还没完成群推送的摘要。 */
export function listUnpushedLiveSummaries(options?: StorageOptions): UnpushedLiveSummary[] {
  const database = openDanmuDatabase(options);

  try {
    const rows = database
      .prepare(`
        SELECT id, room_id, streamer, live_summary
        FROM danmu_session
        WHERE live_summary_status = 'ok'
          AND live_summary_source = 'bot'
          AND live_summary_pushed = 0
          AND live_summary IS NOT NULL
        ORDER BY id ASC
      `)
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row.id),
      roomId: String(row.room_id),
      streamer: String(row.streamer),
      text: String(row.live_summary),
    }));
  } finally {
    database.close();
  }
}

function readLiveSummaryRow(
  database: DatabaseSync,
  sessionId: number,
): (StoredLiveSummary & { claimedAt: string | null }) | undefined {
  const row = database
    .prepare(`
      SELECT ended_at, live_summary, live_summary_status, live_summary_source,
             live_summary_pushed, live_summary_claimed_at
      FROM danmu_session
      WHERE id = ?
    `)
    .get(sessionId) as Record<string, unknown> | undefined;

  if (!row) {
    return undefined;
  }

  return {
    ...mapLiveSummaryRow(row),
    claimedAt: row.live_summary_claimed_at == null ? null : (row.live_summary_claimed_at as string),
  };
}
