import type { NapcatClientPort } from "@nana/napcat";

/**
 * 库自带重连的尝试次数：设为「无限」。
 *
 * node-napcat-ts 的重连是**有预算**的：`onclose` 时只要
 * `nowAttempts < attempts` 才会排下一次重连，用完就永久停止，而且此时
 * `connect()` 既不报错也不重连（`#socket` / `#connectingPromise` 都是陈旧值，
 * 返回的 Promise 永不 settle）。所以库自身的重试只当快路径（每
 * {@link RECONNECT_DELAY_MS} 一次），真正的兜底交给 {@link ConnectionSupervisor}。
 */
export const UNLIMITED_RECONNECT_ATTEMPTS = Number.POSITIVE_INFINITY;

/** 库两次重连尝试之间的间隔（毫秒）。 */
export const RECONNECT_DELAY_MS = 5_000;

/** 首次 `connect()` 的最长等待时间（毫秒）：超时后不再阻塞启动，交给看门狗持续重连。 */
export const CONNECT_TIMEOUT_MS = 15_000;

/** 看门狗日志出口，默认落到 console。 */
export interface ConnectionLogger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
}

export interface ConnectionSupervisorOptions {
  /** false 时只跟踪连接事件，不探活或强制重连。 */
  enabled?: boolean;
  /** 巡检间隔（毫秒），默认 10000。 */
  intervalMs?: number;
  /**
   * 断开状态下，多久没有任何 socket 活动就认为库已经放弃重连、强制重建连接（毫秒），
   * 默认 20000。必须大于 {@link RECONNECT_DELAY_MS}，否则会和库自己的重试相互打架。
   */
  disconnectedIdleMs?: number;
  /**
   * 已连接状态下，多久没收到任何 NapCat 事件才发起一次主动探活（毫秒），默认 60000。
   * 这段时间没有任何入向流量，通常意味着 TCP 连接已半开（对端消失但本端收不到 close）。
   */
  inboundIdleMs?: number;
  /** 两次主动探活之间的最小间隔（毫秒），默认 60000。 */
  probeIntervalMs?: number;
  /** 单次主动探活的超时（毫秒），默认 10000。 */
  probeTimeoutMs?: number;
  /**
   * 两次强制重建连接之间的最小间隔（毫秒），默认 5000。
   *
   * 这里用「冷却时间」而不是「在途锁」：目标不可达时 `reconnect()` 内部会一直等
   * `connect()` 的 Promise（它只在 socket 打开时才 resolve），永远不会 settle，
   * 用它当在途标志会把看门狗永久锁死。
   */
  reconnectCooldownMs?: number;
  /**
   * 连接状态类日志的节流窗口（毫秒），默认 300000（5 分钟）。
   *
   * 长期离线时库每 5 秒就失败一次，不节流会每天刷出几万行日志。正常运行时距上次输出
   * 早已超过这个窗口，所以真正的状态变化照旧第一时间打出来。
   */
  logThrottleMs?: number;
  /** 时钟注入点，便于测试，默认 `Date.now`。 */
  now?: () => number;
  /** 日志出口，默认 console。 */
  logger?: ConnectionLogger;
}

/** `task` 是否在 `ms` 内敲定（resolve 记 true，reject 或超时记 false）。 */
export async function settleWithin(task: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_LOGGER: ConnectionLogger = {
  info: (message) => console.log(message),
  warn: (message, error) => console.warn(message, error),
};

/**
 * NapCat 连接看门狗：把「库自己不管了」的连接重新拉起来，让机器人不需要人工重启。
 *
 * node-napcat-ts 有三种情况会永久失联，库本身都不再自救：
 *
 * 1. 重连预算耗尽（`attempts` 次尝试用完），且此刻 `connect()` 会挂起而不是重连；
 * 2. 连接卡在 CONNECTING（对端不在，TCP 握手黑洞）；
 * 3. TCP 半开——对端消失但本端收不到 close，`socket.close` 永远不会触发。
 *
 * 前两种表现为「断开后 socket 活动时间停滞」，第三种表现为「自称已连接但长时间
 * 收不到任何 NapCat 事件」。两种情况都由本类巡检并强制 `reconnect()`。
 */
export class ConnectionSupervisor {
  private readonly enabled: boolean;
  private readonly ws: NapcatClientPort;
  private readonly intervalMs: number;
  private readonly disconnectedIdleMs: number;
  private readonly inboundIdleMs: number;
  private readonly probeIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private readonly reconnectCooldownMs: number;
  private readonly logThrottleMs: number;
  private readonly now: () => number;
  private readonly logger: ConnectionLogger;

  private unsubscribes: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private connected = false;
  private lastSocketActivityAt = 0;
  private lastInboundAt = 0;
  private lastProbeAt = 0;
  private lastForceAt = 0;
  /** 「已连接」日志的上一次输出时间；-Infinity 保证第一条一定打出。 */
  private lastOpenLogAt = Number.NEGATIVE_INFINITY;
  /** 故障类日志（断开 / 重连失败 / 看门狗出手）的上一次输出时间。 */
  private lastDegradedLogAt = Number.NEGATIVE_INFINITY;
  /** 本轮断开是否已经打过「断开」详情，用来决定后续打摘要还是详情。 */
  private loggedDisconnect = false;
  /** 看门狗最近一次出手的原因，附在周期性摘要里。 */
  private lastAction: string | undefined;

  constructor(ws: ConnectionSupervisor["ws"], options: ConnectionSupervisorOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.ws = ws;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.disconnectedIdleMs = options.disconnectedIdleMs ?? 20_000;
    this.inboundIdleMs = options.inboundIdleMs ?? 60_000;
    this.probeIntervalMs = options.probeIntervalMs ?? 60_000;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
    this.reconnectCooldownMs = options.reconnectCooldownMs ?? 5_000;
    this.logThrottleMs = options.logThrottleMs ?? 300_000;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? DEFAULT_LOGGER;
  }

  /** 是否处于「已连接」状态（按 `socket.open` / `socket.close` 事件维护）。 */
  get isConnected(): boolean {
    return this.connected;
  }

  /** 订阅连接事件并启动周期巡检。 */
  start(): void {
    if (this.unsubscribes.length) {
      return;
    }

    const markSocketActivity = () => {
      this.lastSocketActivityAt = this.now();
    };
    const markInbound = () => {
      this.lastInboundAt = this.now();
    };

    const at = this.now();
    this.lastSocketActivityAt = at;
    this.lastInboundAt = at;

    this.unsubscribes = [
      this.ws.onConnectionState((event) => {
        if (event.phase === "connecting") {
          markSocketActivity();
          return;
        }
        if (event.connected) {
          this.connected = true;
          const openedAt = this.now();
          this.lastSocketActivityAt = openedAt;
          this.lastInboundAt = openedAt;
          this.loggedDisconnect = false;
          this.lastAction = undefined;
          this.logConnected();
          return;
        }
        this.connected = false;
        markSocketActivity();
        const attempts = event.reconnectAttempts ?? 0;
        if (this.loggedDisconnect) {
          this.logDegraded(
            () =>
              `[连接看门狗] 仍未连上 NapCat（库已尝试 ${attempts} 次${this.lastAction ? `，看门狗：${this.lastAction}` : ""}）`,
          );
          return;
        }
        this.loggedDisconnect = true;
        this.logDegraded(() => `[连接看门狗] NapCat WebSocket 断开（库已尝试 ${attempts} 次）`);
      }),
      this.ws.onMessage(markInbound),
      this.ws.onHeartbeat(markInbound),
      this.ws.onSocketError((event) => {
        markSocketActivity();
        if (this.enabled && event.errorType === "response_error" && !event.reconnectEnabled) {
          this.logDegraded(
            () => "[连接看门狗] NapCat 返回失败响应，库已永久关闭自动重连，改由看门狗接管",
          );
        }
      }),
    ];

    if (!this.enabled) return;
    this.timer = setInterval(() => {
      void this.check();
    }, this.intervalMs);
    // 不要让看门狗独自撑着进程不退出。
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** 停止巡检并退订所有连接事件。 */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    for (const unsubscribe of this.unsubscribes.splice(0)) {
      unsubscribe();
    }

    this.connected = false;
  }

  /** 执行一次巡检。`start()` 会按 `intervalMs` 周期调用，测试可直接调用。 */
  async check(): Promise<void> {
    if (!this.enabled) return;
    const at = this.now();

    if (!this.connected) {
      // 库自己还在重试时会不断刷新 socket 活动时间；活动时间停滞说明库已经不管了。
      if (at - this.lastSocketActivityAt >= this.disconnectedIdleMs) {
        this.forceReconnect("断开后长时间没有任何重连活动");
      }
      return;
    }

    // 已连接：只有长时间收不到 NapCat 的任何事件时才探活，避免打扰正常但安静的连接。
    if (
      at - this.lastInboundAt < this.inboundIdleMs ||
      at - this.lastProbeAt < this.probeIntervalMs
    ) {
      return;
    }

    await this.probe();
  }

  /** 主动探活：只把「无响应」当成链路已死，NapCat 回了什么都算活着（含 QQ 自身离线）。 */
  private async probe(): Promise<void> {
    this.lastProbeAt = this.now();

    const statusTask = this.ws.getStatus();
    if (await settleWithin(statusTask, this.probeTimeoutMs)) {
      this.lastInboundAt = this.now();
      return;
    }

    this.forceReconnect(`主动探活 ${this.probeTimeoutMs}ms 内无响应`);
  }

  /**
   * 强制重建连接。只用 `reconnect()`：它会先 `disconnect()`（清掉库内部陈旧的
   * `#socket` 与 `#connectingPromise`）再 `connect()`，而直接调 `connect()` 在重试
   * 耗尽后既不重连、返回的 Promise 也永不 settle。
   *
   * 调用方不等待它敲定——目标不可达时它可能永不 settle，只靠冷却时间限制重试频率。
   */
  private forceReconnect(reason: string): void {
    const at = this.now();
    if (at - this.lastForceAt < this.reconnectCooldownMs) {
      return;
    }

    this.lastForceAt = at;
    this.lastAction = `${reason}，强制重建连接`;
    // 长期故障时这里每 20 秒就会跑一次，交给节流；原因会出现在周期性摘要里。
    this.logDegraded(() => `[连接看门狗] ${this.lastAction}`);
    void this.ws.reconnect().catch((error: unknown) => {
      this.logger.warn("[连接看门狗] 强制重建连接失败", error);
    });
  }

  /** 「已连接」日志单独节流：抖动时它和故障日志各自最多留一条，方便看清两个方向。 */
  private logConnected(): void {
    const at = this.now();
    if (at - this.lastOpenLogAt < this.logThrottleMs) {
      return;
    }

    this.lastOpenLogAt = at;
    this.logger.info("[连接看门狗] NapCat WebSocket 已连接");
  }

  /** 故障类日志：窗口内最多输出一条，避免长期离线时每天刷出几万行。 */
  private logDegraded(build: () => string): void {
    const at = this.now();
    if (at - this.lastDegradedLogAt < this.logThrottleMs) {
      return;
    }

    this.lastDegradedLogAt = at;
    this.logger.warn(build());
  }
}
