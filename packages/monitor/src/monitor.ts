import type {
  CreateMonitorOptions,
  LiveEndReason,
  LiveInterruptionReason,
  MonitorController,
  MonitorEvent,
  MonitorFeatureOptions,
  MonitorLogger,
  MonitorSourceHandlers,
  MonitorSubscription,
} from "./types.ts";

/** 异常中断（超管切断 / 直播时长不足）的默认宽限期：10 分钟。 */
export const DEFAULT_GRACE_PERIOD_MS = 10 * 60 * 1000;

/** 视为正常下播的最短直播时长：30 分钟。 */
export const DEFAULT_MIN_NORMAL_LIVE_MS = 30 * 60 * 1000;

/** 同一原因的超管切断在短时间内重复下发时的去重窗口。 */
const CUT_OFF_DEDUPE_MS = 5_000;

const AT_ALL_TOKEN = "{@all}";

type MonitorPhase = "offline" | "live" | "ending";

export function createMonitor(options: CreateMonitorOptions): MonitorController {
  const logger = options.logger ?? consoleLogger;
  const gracePeriodMs = Math.max(0, options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS);
  const minNormalLiveMs = Math.max(0, options.minNormalLiveMs ?? DEFAULT_MIN_NORMAL_LIVE_MS);
  const unrefTimers = options.unrefTimers ?? true;

  let subscription: MonitorSubscription | undefined;
  let phase: MonitorPhase = "offline";
  let liveStartedAt: Date | undefined;
  let endingSince: Date | undefined;
  let endingReason: LiveInterruptionReason | undefined;
  let cutOffReason: string | undefined;
  let lastCutOffAt: number | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let graceChecking = false;

  function emit(event: MonitorEvent): void {
    for (const sink of options.sinks ?? []) {
      Promise.resolve(sink.handle(event)).catch((error) => {
        logger.error(`处理监控事件 ${event.type} 失败`, error);
      });
    }
  }

  function clearGraceTimer(): void {
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer);
      graceTimer = undefined;
    }
  }

  function clearEndingState(): void {
    clearGraceTimer();
    endingSince = undefined;
    endingReason = undefined;
    cutOffReason = undefined;
    lastCutOffAt = undefined;
  }

  function finalizeLiveEnd(
    endedAt: Date,
    reason: LiveEndReason,
    resolvedCutOffReason?: string,
  ): void {
    clearEndingState();
    phase = "offline";
    liveStartedAt = undefined;

    const text = renderMessage(options.messages?.liveEnd ?? `${options.streamer} 下播了`, options);
    emit({
      type: "live.ended",
      roomId: options.roomId,
      streamer: options.streamer,
      message: text,
      timestamp: endedAt,
      reason,
      ...(resolvedCutOffReason !== undefined ? { cutOffReason: resolvedCutOffReason } : {}),
    });
    logger.log(`[${endedAt.toISOString()}] ${text}`);
  }

  async function onGraceExpired(): Promise<void> {
    if (phase !== "ending" || graceChecking || !subscription) {
      return;
    }

    graceTimer = undefined;
    const targetEndedAt = endingSince ?? new Date();
    const targetReason = endingReason ?? "short_live";
    const targetCutOffReason = cutOffReason;

    if (options.checkLiveStatus) {
      graceChecking = true;
      try {
        const stillLive = await options.checkLiveStatus();
        if (phase !== "ending" || !subscription) {
          return;
        }
        if (stillLive) {
          clearEndingState();
          phase = "live";
          logger.log(
            `[直播监控] ${options.streamer} 宽限期到期校验发现仍在直播，取消下播并继续本场监控`,
          );
          emit({
            type: "live.resumed",
            roomId: options.roomId,
            streamer: options.streamer,
            interruptedBy: targetReason,
            message: renderResumeMessage(options),
            timestamp: new Date(),
            silent: true,
          });
          return;
        }
      } catch (error) {
        logger.error(
          `[直播监控] ${options.streamer} 宽限期到期校验直播状态失败，按已下播处理`,
          error,
        );
      } finally {
        graceChecking = false;
      }
    }

    if (phase !== "ending" || !subscription) {
      return;
    }
    finalizeLiveEnd(targetEndedAt, targetReason, targetCutOffReason);
  }

  function enterGracePeriod(
    timestamp: Date,
    reason: LiveInterruptionReason,
    nextCutOffReason?: string,
  ): void {
    phase = "ending";
    endingReason = reason;
    endingSince = endingSince ?? timestamp;
    if (nextCutOffReason !== undefined) {
      cutOffReason = nextCutOffReason;
    }

    clearGraceTimer();
    graceTimer = setTimeout(() => {
      void onGraceExpired();
    }, gracePeriodMs);
    if (unrefTimers) {
      graceTimer.unref?.();
    }
  }

  function isShortLive(timestamp: Date): boolean {
    if (phase !== "live" || !liveStartedAt || gracePeriodMs <= 0 || minNormalLiveMs <= 0) {
      return false;
    }
    return timestamp.getTime() - liveStartedAt.getTime() < minNormalLiveMs;
  }

  const handlers: MonitorSourceHandlers = {
    onLiveStart(event) {
      if (!event.hasLiveTime) {
        logger.log(`[${event.timestamp.toISOString()}] ${options.streamer} 推流 LOG`);
        return;
      }

      if (phase === "ending") {
        const interruptedBy = endingReason ?? "short_live";
        clearEndingState();
        phase = "live";
        liveStartedAt = liveStartedAt ?? event.timestamp;

        const resumeText = renderResumeMessage(options);
        emit({
          type: "live.resumed",
          roomId: options.roomId,
          streamer: options.streamer,
          interruptedBy,
          message: resumeText,
          timestamp: event.timestamp,
        });
        logger.log(
          `[${event.timestamp.toISOString()}] ${options.streamer} 宽限期内重新开播（中断原因：${interruptedBy}）`,
        );
        return;
      }

      if (phase === "live") {
        logger.log(
          `[${event.timestamp.toISOString()}] ${options.streamer} 已在直播中，忽略重复开播事件`,
        );
        return;
      }

      phase = "live";
      liveStartedAt = event.timestamp;
      clearEndingState();

      const text = renderMessage(
        options.messages?.liveStart ?? `${options.streamer} 开始直播`,
        options,
      );
      emit({
        type: "live.started",
        roomId: options.roomId,
        streamer: options.streamer,
        message: text,
        timestamp: event.timestamp,
      });
      logger.log(`[${event.timestamp.toISOString()}] ${text}`);
    },
    onIncomeDanmu(event) {
      // 空内容（部分弹幕只有表情或被过滤）不入事件流，避免下游写出空记录
      if (event.content) {
        emit({
          type: "danmu.received",
          roomId: options.roomId,
          streamer: options.streamer,
          content: event.content,
          userId: event.userId,
          username: event.username,
          timestamp: event.timestamp,
        });
      }

      if (event.content === "qiyuor2") {
        emit({
          type: "monitor.test",
          roomId: options.roomId,
          streamer: options.streamer,
          timestamp: event.timestamp,
        });
      }
    },
    onRoomCutOff(event) {
      const reason = event.reason.trim();
      const nowMs = event.timestamp.getTime();
      if (
        phase === "ending" &&
        endingReason === "cut_off" &&
        cutOffReason === reason &&
        lastCutOffAt !== undefined &&
        Math.abs(nowMs - lastCutOffAt) < CUT_OFF_DEDUPE_MS
      ) {
        return;
      }

      lastCutOffAt = nowMs;
      const text = renderCutOffMessage(options, reason);
      emit({
        type: "live.cutoff",
        roomId: options.roomId,
        streamer: options.streamer,
        reason,
        message: text,
        timestamp: event.timestamp,
      });
      logger.log(`[${event.timestamp.toISOString()}] ${text}`);

      if (gracePeriodMs > 0) {
        enterGracePeriod(event.timestamp, "cut_off", reason);
        logger.log(
          `[直播监控] ${options.streamer} 被超管切断，进入 ${Math.round(gracePeriodMs / 1000)} 秒宽限期`,
        );
        return;
      }

      finalizeLiveEnd(event.timestamp, "cut_off", reason);
    },
    onLiveEnd(event) {
      if (phase === "ending") {
        // 已经进入宽限期（如超管切断紧随 PREPARING），忽略重复下播信号，等待宽限期结果。
        return;
      }

      if (isShortLive(event.timestamp)) {
        const elapsedMinutes = Math.max(
          0,
          Math.floor((event.timestamp.getTime() - (liveStartedAt?.getTime() ?? 0)) / 60_000),
        );
        enterGracePeriod(event.timestamp, "short_live");
        logger.log(
          `[直播监控] ${options.streamer} 直播时长不足 ${Math.round(minNormalLiveMs / 60_000)} 分钟（当前约 ${elapsedMinutes} 分钟），视为异常中断，进入 ${Math.round(gracePeriodMs / 1000)} 秒宽限期`,
        );
        return;
      }

      finalizeLiveEnd(event.timestamp, "normal");
    },
    onOpen() {
      emit({ type: "connection.open", roomId: options.roomId, streamer: options.streamer });
      logger.log(`[直播监控] 已连接直播间 ${options.roomId}`);
    },
    onClose() {
      emit({ type: "connection.close", roomId: options.roomId, streamer: options.streamer });
      logger.log(`[直播监控] 直播间 ${options.roomId} 连接已关闭`);
    },
    onError(error) {
      emit({
        type: "connection.error",
        roomId: options.roomId,
        streamer: options.streamer,
        error,
      });
      logger.error(`[直播监控] 直播间 ${options.roomId} 监听异常`, error);
    },
  };

  return {
    start() {
      if (subscription) {
        return;
      }

      subscription = options.source.listen(options.roomId, handlers);
    },
    async stop() {
      clearEndingState();
      const currentSubscription = subscription;
      subscription = undefined;
      await currentSubscription?.close();
    },
    syncLiveState(state) {
      if (state.live) {
        if (phase === "offline") {
          phase = "live";
          liveStartedAt = state.startedAt ?? new Date();
        } else if (phase === "live" && !liveStartedAt && state.startedAt) {
          liveStartedAt = state.startedAt;
        }
      }
    },
    isInGracePeriod() {
      return phase === "ending";
    },
    handlePollOffline(timestamp = new Date()) {
      if (phase === "ending") {
        return true;
      }

      if (isShortLive(timestamp)) {
        enterGracePeriod(timestamp, "short_live");
        logger.log(
          `[直播监控] 轮询发现 ${options.streamer} 断流且直播时长不足 ${Math.round(minNormalLiveMs / 60_000)} 分钟，进入 ${Math.round(gracePeriodMs / 1000)} 秒宽限期`,
        );
        return true;
      }

      clearEndingState();
      phase = "offline";
      liveStartedAt = undefined;
      return false;
    },
  };
}

function renderMessage(template: string, options: MonitorFeatureOptions): string {
  return template
    .replaceAll("{uname}", options.streamer)
    .replaceAll("{roomId}", String(options.roomId));
}

function stripAtAllToken(text: string): string {
  return text
    .replaceAll(AT_ALL_TOKEN, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

function renderResumeMessage(options: MonitorFeatureOptions): string {
  const template =
    options.messages?.liveResume ?? options.messages?.liveStart ?? `${options.streamer} 重新开播`;
  const rendered = stripAtAllToken(renderMessage(template, options));
  return rendered || `${options.streamer} 重新开播`;
}

function renderCutOffMessage(options: MonitorFeatureOptions, reason: string): string {
  if (options.messages?.liveCutOff) {
    const rendered = stripAtAllToken(
      renderMessage(options.messages.liveCutOff, options).replaceAll(
        "{reason}",
        reason || "未说明",
      ),
    );
    if (rendered) {
      return rendered;
    }
  }
  return reason
    ? `${options.streamer} 直播间被超管切断（原因：${reason}）`
    : `${options.streamer} 直播间被超管切断`;
}

const consoleLogger: MonitorLogger = {
  log: console.log,
  error: console.error,
};
