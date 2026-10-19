import { appendDanmuMessages } from "@nana/storage";
import type { DanmuMessageInput, StorageOptions } from "@nana/storage";

/** 内存队列的批量落库窗口：到达间隔或条数任一命中即提交。 */
export const FLUSH_INTERVAL_MS = 5_000;
export const FLUSH_BATCH_SIZE = 200;

/**
 * 弹幕写入队列。
 *
 * 每条弹幕先进入内存队列，按 {@link FLUSH_INTERVAL_MS} / {@link FLUSH_BATCH_SIZE} 批量写 SQLite，
 * 避免整场直播每条弹幕都开关一次数据库连接。写入失败只记日志，不影响监听主流程。
 */
export class DanmuStore {
  private buffer: DanmuMessageInput[] = [];
  private readonly getSessionId: () => number | undefined;
  private readonly storage: StorageOptions;

  constructor(getSessionId: () => number | undefined, storage: StorageOptions = {}) {
    this.getSessionId = getSessionId;
    this.storage = storage;
  }

  enqueue(message: DanmuMessageInput): void {
    this.buffer.push(message);
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      this.flush();
    }
  }

  /** 把队列写入数据库；`sessionId` 显式传入时优先使用（收尾后 session 已清空）。 */
  flush(sessionId?: number): void {
    const targetSessionId = sessionId ?? this.getSessionId();
    const pending = this.buffer;
    if (targetSessionId === undefined || pending.length === 0) {
      return;
    }

    this.buffer = [];
    try {
      appendDanmuMessages(targetSessionId, pending, this.storage);
    } catch (error) {
      console.error(`[弹幕录制] 场次 #${targetSessionId} 写入弹幕失败`, error);
    }
  }
}

export type { DanmuMessageInput };
