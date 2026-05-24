import "dotenv/config";
import { createApp } from "./core/index.js";
import { loadMonitorConfig, monitorFeature } from "./features/monitor/index.js";
import { readOptionalNumberEnv } from "./lib/utils.js";

const app = createApp({
  websocket: {
    baseUrl: process.env.NC_WS_URL ?? "ws://127.0.0.1:6099",
    accessToken: process.env.NC_ACCESS_TOKEN,
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000,
    },
  },
  adminGroupId: readOptionalNumberEnv("ADM_GROUP"),
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
    notifyGroupIds: streamerConfig.notifyGroups,
    messages: streamerConfig.messages,
  });
}

app.start().catch((error) => {
  console.error("[app] 启动失败", error);
});
