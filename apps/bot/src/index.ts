import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { resolveProjectRoot } from "@nana/utils";
import { ENV_KEYS, NANA_CONFIG_FILE } from "@nana/constants";
import {
  createApp,
  createLoggerManager,
  RECONNECT_DELAY_MS,
  UNLIMITED_RECONNECT_ATTEMPTS,
  type App,
  type Logger,
} from "./core";
import {
  createMonitorFeature,
  loadMonitorConfig,
  syncLiveStatus,
  type MonitorStreamerConfig,
} from "./monitor";
import {
  createOfflineStateStore,
  loadOfflineDetectorConfig,
  offlineDetectorFeature,
} from "./offline";
import {
  createBarkNotifier,
  createCompositeNotifier,
  createEmailNotifier,
  type Notifier,
} from "@nana/notify";
import {
  createWordCloudMonitorSink,
  DanmuRecorder,
  fetchIsLive,
  loadWordCloudConfig,
  resumeDanmuSessions,
  type SessionClosedHandler,
  toWordCloudSender,
  type WordCloudSender,
  wordCloudFeature,
} from "./danmu";
import { publishLiveSummary, pushUnsentLiveSummaries } from "./summary";
import { groupStreamersByAccount, loadNapcatAccountSet, type NapcatAccount } from "./accounts";

// 入口文件所在目录（开发时是 src/，构建后是 dist/），用于定位不依赖 cwd 的路径。
const entryDir = dirname(fileURLToPath(import.meta.url));

// 相对入口文件（dist/index.mjs）定位 ../.env，避免依赖进程 cwd（例如 pm2 的 cwd 配置）。
const envFile = resolve(entryDir, "..", ".env");
loadEnv({ path: envFile });

/**
 * 解析一次项目根目录，供所有需要落盘的路径复用。
 *
 * 优先从入口文件向上找 `nana.config.yaml`，这样 pm2 把 `cwd` 配成哪里都不影响；
 * 找不到时（例如只部署了 dist 目录）再退回 `@nana/utils` 基于 cwd 的既有逻辑。
 */
function resolveAppRoot(): string {
  let currentDir = resolve(entryDir, "..");
  while (true) {
    if (existsSync(join(currentDir, NANA_CONFIG_FILE))) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return resolveProjectRoot();
}

const projectRoot = resolveAppRoot();
const loggers = createLoggerManager({ rootDir: projectRoot });
const appLogger = loggers.root;

interface AccountRuntime {
  app: App;
  streamers: MonitorStreamerConfig[];
  sendWordCloud: WordCloudSender;
  onSessionClosed?: SessionClosedHandler;
  logger: Logger;
}

async function main(): Promise<void> {
  const { accounts, unavailable } = loadNapcatAccountSet();
  const unavailableAccountIds = new Set(unavailable.map((account) => account.id));
  for (const account of unavailable) {
    appLogger.warn(
      `[app] NapCat 账号 ${account.name}（${account.id}）暂不可用，已跳过：${account.error.message}`,
    );
  }

  const monitorConfig = loadMonitorConfig();
  const wordCloudConfig = loadWordCloudConfig();
  const streamersByAccount = groupStreamersByAccount(monitorConfig.streamers, accounts, {
    skipAccountIds: unavailableAccountIds,
  });
  const summaryApiKey = process.env[ENV_KEYS.DEEPSEEK_API_KEY];
  const showAccountLabel = accounts.length > 1;

  let offlineConfig: ReturnType<typeof loadOfflineDetectorConfig> | undefined;
  try {
    offlineConfig = loadOfflineDetectorConfig();
  } catch (error) {
    appLogger.warn("[app] 未启用离线告警（缺少 adminEmail 配置）", error);
  }

  const runtimes: AccountRuntime[] = [];
  for (const account of accounts) {
    const streamers = streamersByAccount.get(account.id) ?? [];
    const accountLogger = loggers.account(account.id, account.name);
    if (!account.adminGroupId) {
      accountLogger.warn("未配置 adminGroup，该账号的上线 / 下线提示不会发送");
    } else {
      accountLogger.info(`上线 / 下线提示目标管理群：${account.adminGroupId}`);
    }
    const app = createApp({
      websocket: {
        baseUrl: account.wsUrl,
        accessToken: account.accessToken,
        reconnection: {
          enable: true,
          // 不给库设重连预算：预算耗尽后它会永久停止重连，而且此时 connect() 会挂起而不是报错。
          attempts: UNLIMITED_RECONNECT_ATTEMPTS,
          delay: RECONNECT_DELAY_MS,
        },
      },
      account: { id: account.id, name: account.name },
      adminGroupId: account.adminGroupId,
      logger: accountLogger,
      // 推送记录也写入项目根的 db/，不再依赖 cwd。
      storage: { rootDir: projectRoot },
      // 多个 App 共用一次进程信号处理，避免每个账号都发一遍下线消息。
      handleSignals: false,
    });

    app.on("socket.open", () => {
      const text = showAccountLabel ? `我来了~（${account.name}）` : "我来了~";
      app
        .sendAdminText(text, { purpose: "app.online" })
        .then(() => {
          if (account.adminGroupId) {
            accountLogger.info(`上线提示已发送到管理群 ${account.adminGroupId}`);
          }
        })
        .catch((error) => {
          accountLogger.error(`[app] ${account.name} 发送机器人连接提示失败`, error);
        });
    });

    // 每个主播只建一条 blive 长连接：开播通知与弹幕录制共用同一条连接的事件流。
    // 录制器要等监控 setup 才创建，轮询/停机必须拿这张 Map 的引用，不能提前拷贝。
    const recorders = new Map<number, DanmuRecorder>();
    // 词云发到该主播自己配置的群，不再回落到 ADM_GROUP。
    const sendWordCloud = toWordCloudSender(app);
    const wordCloudEnabled = streamers.some((streamer) => streamer.wordCloud.enabled);
    const onSessionClosed: SessionClosedHandler | undefined = wordCloudEnabled
      ? async (input): Promise<void> => {
          await publishLiveSummary({
            sessionId: input.sessionId,
            streamer: input.streamer.streamer,
            notifyGroupIds: input.streamer.notifyEnabled ? input.streamer.notifyGroups : [],
            send: sendWordCloud,
            rootDir: projectRoot,
            apiKey: summaryApiKey,
            logger: accountLogger,
          });
        }
      : undefined;
    const wordCloudOptions = wordCloudEnabled
      ? {
          streamers,
          config: wordCloudConfig,
          rootDir: projectRoot,
          sendWordCloud,
          recorders,
          onSessionClosed,
          logger: accountLogger,
        }
      : undefined;
    const danmuSinkFactory = wordCloudOptions
      ? createWordCloudMonitorSink(wordCloudOptions, recorders)
      : undefined;

    for (const streamerConfig of streamers) {
      app.use(
        createMonitorFeature({
          rootDir: projectRoot,
          createSink: () => danmuSinkFactory?.(streamerConfig),
        }),
        {
          roomId: streamerConfig.roomId,
          streamer: streamerConfig.streamer,
          uid: streamerConfig.uid,
          notifyEnabled: streamerConfig.notifyEnabled,
          notifyGroupIds: streamerConfig.notifyGroups,
          messages: streamerConfig.messages,
        },
      );
    }

    if (wordCloudOptions) {
      app.use(wordCloudFeature, wordCloudOptions);
    }

    if (offlineConfig) {
      const notifiers = [createEmailNotifier(offlineConfig.notifier)];
      if (process.env[ENV_KEYS.BARK_KEY]) {
        notifiers.push(createBarkNotifier());
      }
      const notifier = createCompositeNotifier(notifiers);
      app.use(offlineDetectorFeature, {
        notifier: showAccountLabel ? withAccountLabel(notifier, account) : notifier,
        confirmCount: offlineConfig.confirmCount,
        notifyRecovery: offlineConfig.notifyRecovery,
        storage: { rootDir: projectRoot },
        // 默认账号继续用旧文件，站点「告警」页仍能看到主号状态；
        // 其它账号各用一份状态文件，避免互相覆盖在线/离线状态机。
        store: createOfflineStateStore({
          rootDir: projectRoot,
          accountId: account.id === accounts[0]?.id ? undefined : account.id,
        }),
      });
    }

    runtimes.push({ app, streamers, sendWordCloud, onSessionClosed, logger: accountLogger });
  }

  registerShutdown(runtimes.map((runtime) => runtime.app));
  const startResults = await Promise.allSettled(runtimes.map((runtime) => runtime.app.start()));
  const activeRuntimes: AccountRuntime[] = [];
  const startErrors: unknown[] = [];
  for (const [index, result] of startResults.entries()) {
    const runtime = runtimes[index];
    if (result.status === "fulfilled") {
      activeRuntimes.push(runtime);
      continue;
    }

    startErrors.push(result.reason);
    runtime.logger.error(
      `[app] NapCat 账号 ${runtime.app.accountId ?? "unknown"} 启动失败`,
      result.reason,
    );
    await runtime.app.stop();
  }

  if (activeRuntimes.length === 0) {
    throw new AggregateError(startErrors, "所有 NapCat 账号均启动失败");
  }

  try {
    await syncLiveStatus(monitorConfig.streamers, {
      rootDir: projectRoot,
      logger: appLogger,
    });
  } catch (error) {
    appLogger.error("[app] 同步启动时的直播状态失败", error);
  }

  // 上一场直播若在机器人停机期间结束，等状态同步完成后再补收尾，避免误判为「仍在直播」。
  // 遗留场次发到该主播自己的词云群。
  for (const runtime of activeRuntimes) {
    if (!runtime.streamers.some((streamer) => streamer.wordCloud.enabled)) {
      continue;
    }

    // roomIds 限定本账号的主播，避免第一个账号把其它账号的摘要误标成已发送。
    await pushUnsentLiveSummaries({
      streamers: runtime.streamers,
      send: runtime.sendWordCloud,
      rootDir: projectRoot,
      roomIds: new Set(runtime.streamers.map((streamer) => streamer.roomId)),
      logger: runtime.logger,
    });
    await resumeDanmuSessions({
      streamers: runtime.streamers,
      config: wordCloudConfig,
      rootDir: projectRoot,
      isLive: (streamer) => fetchIsLive(streamer),
      sendWordCloud: runtime.sendWordCloud,
      onSessionClosed: runtime.onSessionClosed,
      logger: runtime.logger,
    });
  }
}

/** 给每个账号的离线告警加上账号名，便于同一收件箱区分是哪台 NapCat 掉线。 */
function withAccountLabel(notifier: Notifier, account: NapcatAccount): Notifier {
  return {
    async send(message) {
      await notifier.send({ ...message, subject: `[${account.name}] ${message.subject}` });
    },
    async close() {
      await notifier.close?.();
    },
  };
}

/** 多 App 共用 SIGINT / SIGTERM：所有连接都收尾，但每个账号只发一次下线消息。 */
function registerShutdown(apps: readonly App[]): void {
  let stopping = false;
  const stopAll = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    const results = await Promise.allSettled(apps.map((app) => app.stop({ announce: "我溜了~" })));
    for (const result of results) {
      if (result.status === "rejected") {
        appLogger.error("[app] 关闭应用时发生错误", result.reason);
      }
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void stopAll();
    });
  }
}

main().catch((error) => {
  appLogger.error("[app] 启动失败", error);
});
