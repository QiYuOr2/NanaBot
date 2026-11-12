import type { QQClientPort, QQMessagePart } from "@nana/qq";
import type { SendMessageSegment } from "node-napcat-ts";
import { PUSH_PURPOSE_LABELS } from "@nana/constants";
import { writePushLog, type StorageOptions } from "@nana/storage";
import type { GroupPushOptions } from "../core/napcat";
import { consoleLogger, type Logger } from "../core/logger";
import type { OfficialAccount } from "./config";
import type { OfficialAccountConfig } from "@nana/config";

export type OfficialSender = Pick<QQClientPort, "sendGroupMessage">;

/** 兼容现有文本 / 词云消息段，发送使用腾讯 SDK，不依赖 NapCat 连接。 */
export class OfficialPushClient {
  private readonly logger: Logger;
  private readonly client: OfficialSender;
  private readonly account: OfficialAccount;
  private readonly storage: StorageOptions;
  private readonly loadGroups?: () => OfficialAccountConfig["groups"];

  constructor(
    client: OfficialSender,
    account: OfficialAccount,
    storage: StorageOptions = {},
    logger: Logger = consoleLogger,
    loadGroups?: () => OfficialAccountConfig["groups"],
  ) {
    this.logger = logger;
    this.client = client;
    this.account = account;
    this.storage = storage;
    this.loadGroups = loadGroups;
  }

  async sendGroupMsg(
    groupId: number,
    options: GroupPushOptions,
    messages: SendMessageSegment[],
  ): Promise<string> {
    let target = `群${groupId}`;
    const base = {
      account: this.account.id,
      targetId: String(groupId),
      target,
      purpose: options.purpose,
      purposeLabel: options.label ?? PUSH_PURPOSE_LABELS[options.purpose],
      pushedAt: new Date().toISOString(),
      content: options.content ?? null,
      subject: options.subject ?? null,
    };
    try {
      const group = (this.loadGroups?.() ?? this.account.groups)[String(groupId)];
      if (!group) throw new Error(`群 ${groupId} 未配置官方 group_openid 映射。`);
      target = group.name ?? target;
      base.target = target;
      base.targetId = group.openid;
      await this.client.sendGroupMessage(group.openid, this.toQQParts(messages));
      this.record({ ...base, success: true });
      return target;
    } catch (error) {
      this.record({
        ...base,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** OneBot 消息段只存在于 bot 兼容层，不进入官方通信包。 */
  private toQQParts(messages: SendMessageSegment[]): QQMessagePart[] {
    return messages.map((message): QQMessagePart => {
      switch (message.type) {
        case "text":
          return { type: "text", text: message.data.text };
        case "image":
          return { type: "image", source: message.data.file };
        case "at":
          if (message.data.qq === "all") return { type: "atAll" };
          break;
      }
      throw new Error(`官方 QQ 通道不支持消息段 ${message.type}。`);
    });
  }

  private record(input: Parameters<typeof writePushLog>[0]) {
    try {
      writePushLog(input, this.storage);
    } catch (error) {
      this.logger.error("[官方 QQ] 写入推送记录失败", error);
    }
  }
}
