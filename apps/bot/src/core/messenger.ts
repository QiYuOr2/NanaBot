import { Structs, type SendMessageSegment } from "node-napcat-ts";

export type NotificationTarget =
  | { type: "group"; groupId: number }
  | { type: "admin" };

export interface Messenger {
  sendText(target: NotificationTarget, text: string): Promise<void>;
  sendMessage(target: NotificationTarget, messages: SendMessageSegment[]): Promise<void>;
  sendGroupText(groupId: number, text: string): Promise<void>;
  sendGroupMsg(groupId: number, messages: SendMessageSegment[]): Promise<void>;
  sendAdminText(text: string): Promise<void>;
  sendAdminMsg(messages: SendMessageSegment[]): Promise<void>;
}

export interface MessengerFactory {
  createMessenger(options: {
    adminGroupId?: number;
    napcat: {
      sendGroupMsg(payload: { group_id: number; message: SendMessageSegment[] }): Promise<void>;
    };
  }): Messenger;
}

export function createDefaultMessengerFactory(): MessengerFactory {
  return {
    createMessenger({ adminGroupId, napcat }) {
      return {
        async sendText(target, text) {
          if (target.type === "group") {
            await napcat.sendGroupMsg({
              group_id: target.groupId,
              message: [Structs.text(text)],
            });
            return;
          }

          if (target.type === "admin") {
            if (!adminGroupId) {
              return;
            }

            await napcat.sendGroupMsg({
              group_id: adminGroupId,
              message: [Structs.text(text)],
            });
            return;
          }

          throw new Error("默认 messenger 仅支持 group/admin 目标。若需要支持其他通知目标，请提供自定义 messengerFactory。" );
        },
        async sendMessage(target, messages) {
          if (target.type === "group") {
            await napcat.sendGroupMsg({
              group_id: target.groupId,
              message: messages,
            });
            return;
          }

          if (target.type === "admin") {
            if (!adminGroupId) {
              return;
            }

            await napcat.sendGroupMsg({
              group_id: adminGroupId,
              message: messages,
            });
            return;
          }

          throw new Error("默认 messenger 仅支持 group/admin 目标。若需要支持其他通知目标，请提供自定义 messengerFactory。" );
        },
        async sendGroupText(groupId, text) {
          await this.sendText({ type: "group", groupId }, text);
        },
        async sendGroupMsg(groupId, messages) {
          await this.sendMessage({ type: "group", groupId }, messages);
        },
        async sendAdminText(text) {
          await this.sendText({ type: "admin" }, text);
        },
        async sendAdminMsg(messages) {
          await this.sendMessage({ type: "admin" }, messages);
        },
      };
    },
  };
}

