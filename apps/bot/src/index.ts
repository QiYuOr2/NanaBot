import "dotenv/config";
import { readOptionalNumberEnv } from "@nana/utils";
import { DEFAULT_NC_WS_URL, ENV_KEYS } from "@nana/constants";
import { createApp } from "./core";
import { loadMonitorConfig, monitorFeature } from "./monitor";

console.log(`[app] ${ENV_KEYS.NC_ACCESS_TOKEN}: ${process.env[ENV_KEYS.NC_ACCESS_TOKEN]}`);

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
  app.sendAdminText("我来了~").catch((error) => {
    console.error("[app] 发送机器人连接提示失败", error);
  });
});

const monitorConfig = loadMonitorConfig();

for (const streamerConfig of monitorConfig.streamers) {
  app.use(monitorFeature, {
    roomId: streamerConfig.roomId,
    streamer: streamerConfig.streamer,
    notifyEnabled: streamerConfig.notifyEnabled,
    notifyGroupIds: streamerConfig.notifyGroups,
    messages: streamerConfig.messages,
  });
}

app.start().catch((error) => {
  console.error("[app] 启动失败", error);
});
