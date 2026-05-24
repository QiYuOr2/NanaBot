import { startListen, type MessageListener } from "blive-message-listener";
import { Structs } from "node-napcat-ts";
import { defineFeature, type FeatureContext } from "../../core/index.js";
import { dateFormat } from "../../lib/date.js";

export interface MonitorFeatureOptions {
  roomId: number;
  streamer: string;
  notifyGroupIds?: number[];
  messages?: {
    liveStart?: string;
    replayStart?: string;
    liveEnd?: string;
  };
}

export const monitorFeature = defineFeature<MonitorFeatureOptions>({
  name: "直播监控",
  setup(context, options) {
    const listener = createMonitorListener(context, options);

    return () => {
      listener.close();
    };
  },
});

function createMonitorListener(context: FeatureContext, options: MonitorFeatureOptions): MessageListener {
  return startListen(options.roomId, {
    onLiveStart: (message) => {
      const isReplay = Boolean(message.raw["live_time"]);
      const text = isReplay
        ? renderMessage(options.messages?.replayStart ?? `${options.streamer} 开始推流`, options)
        : renderMessage(options.messages?.liveStart ?? `${options.streamer} 开播了`, options);

      if (message.raw["live_time"]) {
        sendGroupText(context, options, text)
          .catch((error) => {
            console.error(
              `[直播监控] 向群发送 "${options.streamer}" 开播通知失败`,
              error,
            );
          });
      }

      console.log(`[${dateFormat(message.timestamp)}] ${text}`);
    },
    onLiveEnd: (message) => {
      const text = renderMessage(options.messages?.liveEnd ?? `${options.streamer} 下播了`, options);

      console.log(`[${dateFormat(message.timestamp)}] ${text}`);

      sendGroupText(context, options, text).catch((error) => {
        console.error(
          `[直播监控] 向群发送 "${options.streamer}" 下播通知失败`,
          error,
        );
      });
    },
    onOpen: () => {
      console.log(`[直播监控] 已连接直播间 ${options.roomId}`);
    },
    onClose: () => {
      console.log(`[直播监控] 直播间 ${options.roomId} 连接已关闭`);
    },
    onError: (error) => {
      console.error(`[直播监控] 直播间 ${options.roomId} 监听异常`, error);
    },
  });
}

async function sendGroupText(context: FeatureContext, options: MonitorFeatureOptions, text: string) {
  const groupIds = options.notifyGroupIds ?? [];

  if (groupIds.length === 0) {
    return;
  }

  for (const groupId of groupIds) {
    await context.ws.send_group_msg({
      group_id: groupId,
      message: [Structs.text(text)],
    });
  }
}

function renderMessage(template: string, options: MonitorFeatureOptions) {
  return template
    .replaceAll("{streamer}", options.streamer)
    .replaceAll("{roomId}", String(options.roomId));
}
