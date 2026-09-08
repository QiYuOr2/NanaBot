import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { readOptionalNumberEnv } from "@nana/utils";
import { DEFAULT_NC_WS_URL, ENV_KEYS } from "@nana/constants";
import { createApp } from "./core";
import { loadMonitorConfig, monitorFeature, syncLiveStatus } from "./monitor";
import { loadOfflineDetectorConfig, offlineDetectorFeature } from "./offline";
import { createBarkNotifier, createEmailNotifier } from "@nana/notify";

// 相对入口文件（dist/index.mjs）定位 ../.env，避免依赖进程 cwd（例如 pm2 的 cwd 配置）。
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
loadEnv({ path: envFile });

const accessToken = process.env[ENV_KEYS.NC_ACCESS_TOKEN];
if (!accessToken) {
  console.error(
    `[app] 缺少环境变量 ${ENV_KEYS.NC_ACCESS_TOKEN}。请确认 ${envFile} 存在且包含该变量（或在 pm2 env 中提供）。`,
  );
  throw new Error(`缺少环境变量 ${ENV_KEYS.NC_ACCESS_TOKEN}`);
}
console.log(`[app] ${ENV_KEYS.NC_ACCESS_TOKEN}: ${accessToken}`);

async function main(): Promise<void> {
  const app = createApp({
    websocket: {
      baseUrl: process.env[ENV_KEYS.NC_WS_URL] ?? DEFAULT_NC_WS_URL,
      accessToken: process.env[ENV_KEYS.NC_ACCESS_TOKEN],
      reconnection: {
        enable: true,
        attempts: 10,
        delay: 5000,
      },
    },
    adminGroupId: readOptionalNumberEnv(ENV_KEYS.ADM_GROUP),
  });

  app.on("socket.open", () => {
    app.sendAdminText("我来了~", { purpose: "app.online" }).catch((error) => {
      console.error("[app] 发送机器人连接提示失败", error);
    });
  });

  const monitorConfig = loadMonitorConfig();

  for (const streamerConfig of monitorConfig.streamers) {
    app.use(monitorFeature, {
      roomId: streamerConfig.roomId,
      streamer: streamerConfig.streamer,
      uid: streamerConfig.uid,
      notifyEnabled: streamerConfig.notifyEnabled,
      notifyGroupIds: streamerConfig.notifyGroups,
      messages: streamerConfig.messages,
    });
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
    await syncLiveStatus(monitorConfig.streamers);
  } catch (error) {
    console.error("[app] 同步启动时的直播状态失败", error);
  }
}

main().catch((error) => {
  console.error("[app] 启动失败", error);
});
