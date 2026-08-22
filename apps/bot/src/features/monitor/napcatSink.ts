import type { MonitorEvent, MonitorSink } from "@nana/monitor";
import { Structs } from "node-napcat-ts";
import type { FeatureContext } from "../../core/index";

export function createNapcatMonitorSink(
  context: FeatureContext,
  notifyGroupIds: number[] = [],
): MonitorSink {
  return {
    async handle(event: MonitorEvent) {
      switch (event.type) {
        case "live.started":
          await sendGroupText(context, notifyGroupIds, event.message, event.streamer);
          return;
        case "monitor.test":
          await context.sendAdminMsg([Structs.text("直播间连接测试"), Structs.at("all")]);
          return;
        case "connection.open":
          if (notifyGroupIds.length) {
            await context.sendAdminMsg([
              Structs.text(`对应直播间 ${event.roomId}\n`),
              Structs.text(`已配置 ${notifyGroupIds.join(",")}\n`),
              Structs.text(`AdminID ${context.adminGroupId}`),
            ]);
          }
          return;
        case "connection.error":
          await context.sendAdminText("发现了一个问题，请上线检查");
          return;
        case "live.ended":
        case "connection.close":
          return;
      }
    },
  };
}

async function sendGroupText(
  context: FeatureContext,
  groupIds: number[],
  text: string,
  streamer: string,
) {
  for (const groupId of groupIds) {
    try {
      await context.ws.send_group_msg({
        group_id: groupId,
        message: [Structs.text(text), Structs.at("all")],
      });
    } catch (error) {
      console.error(`[直播监控] 向群 ${groupId} 发送 "${streamer}" 开播通知失败`, error);
      await context.sendAdminMsg([
        Structs.text(`向群 ${groupId} 发送 "${streamer}" 开播通知失败`),
        Structs.text(`错误信息: ${error instanceof Error ? error.message : String(error)}`),
      ]);
    }
  }
}
