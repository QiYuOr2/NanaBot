import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { readOptionalNumberEnv, resolveProjectRoot } from "@nana/utils";
import { DEFAULT_NC_WS_URL, ENV_KEYS, NANA_CONFIG_FILE } from "@nana/constants";
import { createApp, RECONNECT_DELAY_MS, UNLIMITED_RECONNECT_ATTEMPTS } from "./core";
import { createMonitorFeature, loadMonitorConfig, syncLiveStatus } from "./monitor";
import { loadOfflineDetectorConfig, offlineDetectorFeature } from "./offline";
import { createBarkNotifier, createEmailNotifier } from "@nana/notify";
import {
  createWordCloudMonitorSink,
  DanmuRecorder,
  fetchIsLive,
  loadWordCloudConfig,
  resumeDanmuSessions,
  toWordCloudSender,
  wordCloudFeature,
} from "./danmu";
import { publishLiveSummary, pushUnsentLiveSummaries } from "./summary";

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

const accessToken = process.env[ENV_KEYS.NC_ACCESS_TOKEN];
if (!accessToken) {
  console.error(
    `[app] 缺少环境变量 ${ENV_KEYS.NC_ACCESS_TOKEN}。请确认 ${envFile} 存在且包含该变量（或在 pm2 env 中提供）。`,
  );
  throw new Error(`缺少环境变量 ${ENV_KEYS.NC_ACCESS_TOKEN}`);
}
console.log(`[app] ${ENV_KEYS.NC_ACCESS_TOKEN}: ${accessToken}`);

async function main(): Promise<void> {
  const adminGroupId = readOptionalNumberEnv(ENV_KEYS.ADM_GROUP);
  const app = createApp({
    websocket: {
      baseUrl: process.env[ENV_KEYS.NC_WS_URL] ?? DEFAULT_NC_WS_URL,
      accessToken: process.env[ENV_KEYS.NC_ACCESS_TOKEN],
      reconnection: {
        enable: true,
        // 不给库设重连预算：预算耗尽后它会永久停止重连，而且此时 connect() 会挂起而不是报错。
        attempts: UNLIMITED_RECONNECT_ATTEMPTS,
        delay: RECONNECT_DELAY_MS,
      },
    },
    adminGroupId,
    // 推送记录也写入项目根的 db/，不再依赖 cwd。
    storage: { rootDir: projectRoot },
  });

  app.on("socket.open", () => {
    app.sendAdminText("我来了~", { purpose: "app.online" }).catch((error) => {
      console.error("[app] 发送机器人连接提示失败", error);
    });
  });

  const monitorConfig = loadMonitorConfig();
  const wordCloudConfig = loadWordCloudConfig();

  // 每个主播只建一条 blive 长连接：开播通知与弹幕录制共用同一条连接的事件流。
  // 录制器要等监控 setup 才创建，轮询/停机必须拿这张 Map 的引用，不能提前拷贝。
  const recorders = new Map<number, DanmuRecorder>();
  // 词云发到该主播自己配置的群，不再回落到 ADM_GROUP。
  const sendWordCloud = toWordCloudSender(app);
  const wordCloudEnabled = monitorConfig.streamers.some((streamer) => streamer.wordCloud.enabled);
  const summaryApiKey = process.env[ENV_KEYS.DEEPSEEK_API_KEY];
  const onSessionClosed = wordCloudEnabled
    ? async (input: {
        sessionId: number;
        streamer: (typeof monitorConfig.streamers)[number];
      }): Promise<void> => {
        await publishLiveSummary({
          sessionId: input.sessionId,
          streamer: input.streamer.streamer,
          notifyGroupIds: input.streamer.notifyEnabled ? input.streamer.notifyGroups : [],
          send: sendWordCloud,
          rootDir: projectRoot,
          apiKey: summaryApiKey,
        });
      }
    : undefined;
  const wordCloudOptions = wordCloudEnabled
    ? {
        streamers: monitorConfig.streamers,
        config: wordCloudConfig,
        rootDir: projectRoot,
        sendWordCloud,
        recorders,
        onSessionClosed,
      }
    : undefined;
  const danmuSinkFactory = wordCloudOptions
    ? createWordCloudMonitorSink(wordCloudOptions, recorders)
    : undefined;

  for (const streamerConfig of monitorConfig.streamers) {
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

  try {
    const offlineConfig = loadOfflineDetectorConfig();
    const notifiers = [createEmailNotifier(offlineConfig.notifier)];
    if (process.env[ENV_KEYS.BARK_KEY]) {
      notifiers.push(createBarkNotifier());
    }
    app.use(offlineDetectorFeature, {
      notifier: notifiers,
      confirmCount: offlineConfig.confirmCount,
      notifyRecovery: offlineConfig.notifyRecovery,
    });
  } catch (error) {
    console.warn("[app] 未启用离线告警（缺少 adminEmail 配置）", error);
  }

  await app.start();

  try {
    await syncLiveStatus(monitorConfig.streamers, { rootDir: projectRoot });
  } catch (error) {
    console.error("[app] 同步启动时的直播状态失败", error);
  }

  // 上一场直播若在机器人停机期间结束，等状态同步完成后再补收尾，避免误判为「仍在直播」。
  // 遗留场次发到该主播自己的词云群。
  if (wordCloudEnabled) {
    await pushUnsentLiveSummaries({
      streamers: monitorConfig.streamers,
      send: sendWordCloud,
      rootDir: projectRoot,
    });
    await resumeDanmuSessions({
      streamers: monitorConfig.streamers,
      config: wordCloudConfig,
      rootDir: projectRoot,
      isLive: (streamer) => fetchIsLive(streamer),
      sendWordCloud,
      onSessionClosed,
    });
  }
}

main().catch((error) => {
  console.error("[app] 启动失败", error);
});
