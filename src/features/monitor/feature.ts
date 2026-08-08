import { startListen, type MessageListener } from "blive-message-listener";
import { Structs } from "node-napcat-ts";
import { defineFeature, type FeatureContext } from "../../core/index";
import { dateFormat } from "../../lib/date";

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
      const hasLiveTime = Boolean(message.raw["live_time"]);
      const text = hasLiveTime
        ? renderMessage(options.messages?.liveStart ?? `${options.streamer} 开始直播`, options)
        : `${options.streamer} 推流 LOG`;

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
    onIncomeDanmu(message) {
      if (message.body.content === 'qiyuor2') {
        context.sendAdminMsg([
          Structs.text('直播间连接测试'),
          Structs.at('all')
        ])
      }
    },
    onLiveEnd: (message) => {
      const text = renderMessage(options.messages?.liveEnd ?? `${options.streamer} 下播了`, options);
      console.log(`[${dateFormat(message.timestamp)}] ${text}`);
    },
    onOpen: () => {
      context.sendAdminText(`打开直播间 ${options.roomId}`)
      console.log(`[直播监控] 已连接直播间 ${options.roomId}`);
    },
    onClose: () => {
      console.log(`[直播监控] 直播间 ${options.roomId} 连接已关闭`);
    },
    onError: (error) => {
      context.sendAdminText('发现了一个问题，请上线检查')
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
      message: [Structs.text(text), Structs.at('all')],
    });
  }
}

function renderMessage(template: string, options: MonitorFeatureOptions) {
  return template
    .replaceAll("{streamer}", options.streamer)
    .replaceAll("{roomId}", String(options.roomId));
}
