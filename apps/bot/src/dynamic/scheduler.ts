/** 简易并发闸门：限制同时运行的任务数量，支持等待所有任务结束。 */
class ConcurrencyGate {
  private active = 0;
  private readonly limit: number;
  private readonly waiters: (() => void)[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

export interface ScheduledTask {
  /** 任务唯一键（通常是 uid）。 */
  key: number;
  /** 单次执行体；抛错由调度器捕获并退避，不影响其它任务。 */
  run: (signal: AbortSignal) => Promise<void>;
  /** 基础间隔（分钟）。 */
  intervalMinutes: number;
}

export interface SchedulerOptions {
  /** 全局并发上限。 */
  concurrency: number;
  /** 随机抖动上限（毫秒），用于打散请求。 */
  jitterMs?: number;
  /** 失败退避基数（毫秒）。实际退避 = 基数 * 2^n，封顶 maxBackoffMs。 */
  backoffBaseMs?: number;
  /** 失败退避上限（毫秒）。 */
  maxBackoffMs?: number;
  logger: {
    info(message: string, error?: unknown): void;
    warn(message: string, error?: unknown): void;
    error(message: string, error?: unknown): void;
  };
}

/**
 * 多 UP 主统一轮询调度器。
 *
 * - 一个可停止的调度器管理所有 UID，不为每个 UP 主创建永久独立 timer（避免泄漏）。
 * - 全局并发受 {@link ConcurrencyGate} 限制。
 * - 每个 UID 同一时刻最多一个在跑的任务（single-flight），上一轮未结束不会重复进入。
 * - 单 UID 失败只影响自身，采用有上限的指数退避；成功后恢复正常间隔。
 * - 任务间加入随机抖动，降低同时请求触发风控的概率。
 * - `stop()` 触发 AbortSignal 并清理所有 timer，不再发起新请求。
 */
export class DynamicScheduler {
  private readonly options: SchedulerOptions;
  private readonly gate: ConcurrencyGate;
  private readonly jitterMs: number;
  private readonly backoffBaseMs: number;
  private readonly maxBackoffMs: number;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<number>();
  private readonly failures = new Map<number, number>();
  private readonly tasks = new Map<number, ScheduledTask>();
  private readonly controller = new AbortController();
  private stopped = false;
  private started = false;

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.gate = new ConcurrencyGate(Math.max(1, options.concurrency));
    this.jitterMs = options.jitterMs ?? 3_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 30_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30 * 60_000;
  }

  /** 注册任务并立即开始第一轮（带抖动）。重复 key 覆盖。 */
  schedule(task: ScheduledTask): void {
    this.tasks.set(task.key, task);
  }

  /** 启动所有已注册任务。 */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    for (const task of this.tasks.values()) {
      this.armInitial(task);
    }
  }

  private armInitial(task: ScheduledTask): void {
    // 首轮抖动，避免所有 UID 同时发起请求。
    const delay = this.randomJitter();
    this.arm(task, delay);
  }

  private randomJitter(): number {
    return this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0;
  }

  private arm(task: ScheduledTask, delayMs: number): void {
    if (this.stopped) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(task.key);
        void this.execute(task);
      },
      Math.max(0, delayMs),
    );
    // Node 下 unref 便于进程退出（存在则调用）。
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(task.key, timer);
  }

  private async execute(task: ScheduledTask): Promise<void> {
    if (this.stopped) return;
    // single-flight：同一 UID 上一轮未结束时跳过本轮。
    if (this.running.has(task.key)) {
      this.options.logger.warn(`[动态监控] uid=${task.key} 上一轮仍在执行，跳过本轮`);
      this.rescheduleAfterSuccess(task);
      return;
    }
    this.running.add(task.key);
    try {
      await this.gate.run(() => task.run(this.controller.signal));
      this.failures.delete(task.key);
      this.rescheduleAfterSuccess(task);
    } catch (error) {
      if (this.stopped) return;
      const count = (this.failures.get(task.key) ?? 0) + 1;
      this.failures.set(task.key, count);
      const backoff = Math.min(this.backoffBaseMs * 2 ** (count - 1), this.maxBackoffMs);
      this.options.logger.warn(
        `[动态监控] uid=${task.key} 轮询失败（第 ${count} 次），${Math.round(backoff / 1000)}s 后重试`,
        error,
      );
      this.arm(task, backoff + this.randomJitter());
    } finally {
      this.running.delete(task.key);
    }
  }

  private rescheduleAfterSuccess(task: ScheduledTask): void {
    const intervalMs = Math.max(1, task.intervalMinutes) * 60_000;
    this.arm(task, intervalMs + this.randomJitter());
  }

  /** 立即对指定 UID 触发一次（测试用）。 */
  async triggerNow(key: number): Promise<void> {
    const task = this.tasks.get(key);
    if (!task) return;
    await this.execute(task);
  }

  /** 停止调度：取消所有 timer 与在途请求，之后不再发起。 */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}
