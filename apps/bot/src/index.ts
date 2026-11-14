import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { readProjectAuthToken, readOptionalNumberEnv, resolveProjectRoot } from "@nana/utils";
import {
  BOT_CONTROL_TEST_MESSAGE_PATH,
  ENV_KEYS,
  NANA_CONFIG_FILE,
  QQ_PROVIDER_LABELS,
} from "@nana/constants";
import { readConfig } from "@nana/config";
import { createLoggerManager, type BotApp, type Logger } from "./core";
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
import {
  groupStreamersByAccount,
  resolveQQAccounts,
  createAccountApp,
  startAccountApps,
  type QQRuntimeAccount,
} from "./accounts";
import { validateOfficialTargets } from "./qq";
import { startBotControlServer, type BotControlServer } from "./control";
import { parseBotNotifications, renderBotNotice } from "./config/notifications.ts";
import { registerStartupNotice } from "./core/startupNotice.ts";
import { createMessageFeature } from "./message/index.ts";

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
  account: QQRuntimeAccount;
  app: BotApp;
  streamers: MonitorStreamerConfig[];
  sendWordCloud: WordCloudSender;
  onSessionClosed?: SessionClosedHandler;
  logger: Logger;
}
const processStartedAt = Date.now();
const connectionStates = new Map<string, () => boolean>();

async function main(): Promise<void> {
  const config = readConfig();
  const { provider, accounts, unavailable, disabled, statusAccountId, configuredCount } =
    resolveQQAccounts(config);
  const notices = parseBotNotifications(config);
  const officialAccounts = accounts.filter((account) => account.provider === "official");
  appLogger.info(`[app] QQ 通道：${provider}`);
  const unavailableAccountIds = new Set([...disabled, ...unavailable.map((account) => account.id)]);
  for (const id of disabled) appLogger.info(`[app] 账号 ${id} 已停用，跳过连接与主播任务`);
  for (const account of unavailable) {
    appLogger.warn(
      `[app] ${QQ_PROVIDER_LABELS[account.provider]} 账号 ${account.name}（${account.id}）暂不可用，已跳过：${account.error.message}`,
    );
  }

  const monitorConfig = loadMonitorConfig();
  const wordCloudConfig = loadWordCloudConfig();
  const streamersByAccount = groupStreamersByAccount(monitorConfig.streamers, accounts, {
    skipAccountIds: unavailableAccountIds,
  });
  for (const streamer of monitorConfig.streamers) {
    if (!streamer.qqAccount)
      appLogger.warn(
        `[app] 主播 ${streamer.streamer} 未配置 qqAccount，已跳过账号推送与监控功能。`,
      );
  }
  for (const account of officialAccounts) {
    try {
      validateOfficialTargets(
        account,
        (streamersByAccount.get(account.id) ?? []).flatMap((streamer) => [
          ...(streamer.notifyEnabled ? streamer.notifyGroups : []),
          ...(streamer.wordCloud.enabled ? streamer.wordCloud.notifyGroups : []),
        ]),
      );
    } catch (error) {
      appLogger.warn(
        `[app] ${account.name} 有群尚未绑定，bot 将继续连接以发现群标识；请在 site 设置中补齐。对应群暂不推送。`,
        error,
      );
    }
  }
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
    accountLogger.info(`QQ 账号通道：${QQ_PROVIDER_LABELS[account.provider]}`);
    const app = createAccountApp(account, {
      storage: { rootDir: projectRoot },
      logger: accountLogger,
    });

    app.use(createMessageFeature(), {
      config: config.message,
      accountConfig: account.message,
      runtime: {
        accountId: account.id,
        accountName: account.name,
        provider: account.provider,
        connected: () => connectionStates.get(account.id)?.() ?? false,
        configuredStreamers: streamers.length,
        configuredAccounts: configuredCount,
        connectedAccounts: () =>
          accounts.filter((entry) => connectionStates.get(entry.id)?.() ?? false).length,
        startedAt: processStartedAt,
        rootDir: projectRoot,
        roomIds: streamers.map((streamer) => streamer.roomId),
      },
      logger: accountLogger,
    });

    registerStartupNotice(app, renderBotNotice(notices.online, account), accountLogger);

    // 每个主播只建一条 blive 长连接：开播通知与弹幕录制共用同一条连接的事件流。
    // 录制器要等监控 setup 才创建，轮询/停机必须拿这张 Map 的引用，不能提前拷贝。
    const recorders = new Map<number, DanmuRecorder>();
    // 词云发到该主播自己配置的群。
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
        // 部署脚本在重启窗口内写下此标记，期间的告警改用「部署中」措辞。
        deploymentMarkerPath: join(projectRoot, ".deploying.json"),
        // 首个配置账号的状态供站点「告警」页展示；
        // 其它账号各用一份状态文件，避免互相覆盖在线/离线状态机。
        store: createOfflineStateStore({
          rootDir: projectRoot,
          accountId: account.id === statusAccountId ? undefined : account.id,
        }),
      });
    }

    runtimes.push({
      account,
      app,
      streamers,
      sendWordCloud,
      onSessionClosed,
      logger: accountLogger,
    });
    connectionStates.set(account.id, () => app.connected);
  }

  let controlServer: BotControlServer | undefined;
  registerShutdown(
    runtimes.map(({ app, account }) => ({
      app,
      announce: renderBotNotice(notices.offline, account),
    })),
    () => controlServer?.stop(),
  );
  const activeRuntimes = await startAccountApps(runtimes);

  let configuredControlPort: number | undefined;
  try {
    configuredControlPort = readOptionalNumberEnv(ENV_KEYS.NANA_BOT_CONTROL_PORT);
  } catch (error) {
    appLogger.warn(`[control] ${ENV_KEYS.NANA_BOT_CONTROL_PORT} 不是有效数字，使用默认端口`, error);
  }
  const controlToken = readProjectAuthToken(projectRoot);
  if (!controlToken || controlToken.length < 16) {
    appLogger.warn("[control] 请在根目录 .env 配置至少 16 位的 NANA_AUTH_TOKEN");
  }
  const controlPort =
    configuredControlPort &&
    Number.isInteger(configuredControlPort) &&
    configuredControlPort > 0 &&
    configuredControlPort <= 65_535
      ? configuredControlPort
      : undefined;
  if (configuredControlPort !== undefined && controlPort === undefined) {
    appLogger.warn(
      `[control] ${ENV_KEYS.NANA_BOT_CONTROL_PORT}=${configuredControlPort} 不合法，使用默认端口`,
    );
  }
  try {
    controlServer = await startBotControlServer({
      runtimes: new Map(
        activeRuntimes.map((runtime) => [
          runtime.account.id,
          { account: runtime.account, app: runtime.app },
        ]),
      ),
      rootDir: projectRoot,
      logger: appLogger,
      ...(controlPort === undefined ? {} : { port: controlPort }),
    });
    appLogger.info(`[control] 测试消息接口：${controlServer.url}${BOT_CONTROL_TEST_MESSAGE_PATH}`);
  } catch (error) {
    appLogger.error("[control] 启动测试消息接口失败，site 测试消息暂不可用", error);
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

/** 给离线告警加上账号名，便于同一收件箱区分哪个 QQ 账号掉线。 */
function withAccountLabel(notifier: Notifier, account: { name: string }): Notifier {
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
function registerShutdown(
  apps: readonly { app: BotApp; announce?: string }[],
  stopExtra?: () => Promise<void> | undefined,
): void {
  let stopping = false;
  const stopAll = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    try {
      await stopExtra?.();
    } catch (error) {
      appLogger.error("[app] 关闭控制接口时发生错误", error);
    }
    const results = await Promise.allSettled(
      apps.map(({ app, announce }) => app.stop({ announce })),
    );
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
