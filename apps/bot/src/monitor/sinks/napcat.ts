import type { MonitorEvent, MonitorSink } from "@nana/monitor";
import type { SendMessageSegment } from "node-napcat-ts";
import { Structs } from "node-napcat-ts";
import type { FeatureContext } from "../../core";

const AT_ALL_TOKEN = "{@all}";

/** 把直播监控事件转换成 QQ 群 / 管理员的 NapCat 通知，并记录推送结果。 */
export function createNapcatMonitorSink(
  context: FeatureContext,
  notifyGroupIds: number[] = [],
  notifyEnabled = true,
): MonitorSink {
  return {
    async handle(event: MonitorEvent) {
      if (!notifyEnabled) {
        return;
      }

      switch (event.type) {
        case "live.started":
          await sendGroupText(context, notifyGroupIds, event.message, event.streamer);
          return;
        case "monitor.test":
          await context.sendAdminMsg(toMessageSegments(`直播间连接测试 ${AT_ALL_TOKEN}`), {
            purpose: "notification",
            label: "测试",
          });
          return;
        case "connection.open":
          if (notifyGroupIds.length) {
            await context.sendAdminMsg(
              [
                Structs.text(`对应直播间 ${event.roomId}\n`),
                Structs.text(`已配置 ${notifyGroupIds.join(",")}\n`),
                Structs.text(`AdminID ${context.adminGroupId}`),
              ],
              { purpose: "app.online" },
            );
          }
          return;
        case "connection.error":
          await context.sendAdminText("发现了一个问题，请上线检查", {
            purpose: "notification",
            label: "错误",
          });
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
  const content = text.replaceAll(AT_ALL_TOKEN, "").trim();

  for (const groupId of groupIds) {
    const isAdminGroup = groupId === context.adminGroupId;

    try {
      await context.sendGroupMsg(
        groupId,
        { purpose: "live.start", content, subject: streamer },
        toMessageSegments(isAdminGroup ? content : text),
      );
    } catch (error) {
      context.logger.error(`[直播监控] 向群 ${groupId} 发送 "${streamer}" 开播通知失败`, error);
      await context.sendAdminMsg(
        [
          Structs.text(`向群 ${groupId} 发送 "${streamer}" 开播通知失败`),
          Structs.text(
            `错误信息: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
          ),
        ],
        { purpose: "notification", label: "错误" },
      );
    }
  }
}

function toMessageSegments(text: string): SendMessageSegment[] {
  if (!text.includes(AT_ALL_TOKEN)) {
    return [Structs.text(text)];
  }

  return text.split(AT_ALL_TOKEN).flatMap((part, index, parts) => {
    const segments: SendMessageSegment[] = [];
    if (part) {
      segments.push(Structs.text(part));
    }
    if (index < parts.length - 1) {
      segments.push(Structs.at("all"));
    }
    return segments;
  });
}
