import { fileURLToPath } from "node:url";
import type { QQBot } from "@tencent-connect/qqbot-nodejs";
import type { SendMessageSegment } from "node-napcat-ts";
import { PUSH_PURPOSE_LABELS } from "@nana/constants";
import { writePushLog, type StorageOptions } from "@nana/storage";
import type { GroupPushOptions } from "../core/napcat";
import { consoleLogger, type Logger } from "../core/logger";
import type { OfficialAccount } from "./config";

export type OfficialSender = Pick<QQBot, "sendText" | "sendImage">;

/** 兼容现有文本 / 词云消息段，发送使用腾讯 SDK，不依赖 NapCat 连接。 */
export class OfficialPushClient {
  private warnedAtAll = false;
  private readonly logger: Logger;
  private readonly bot: OfficialSender;
  private readonly account: OfficialAccount;
  private readonly storage: StorageOptions;

  constructor(
    bot: OfficialSender,
    account: OfficialAccount,
    storage: StorageOptions = {},
    logger: Logger = consoleLogger,
  ) {
    this.logger = logger;
    this.bot = bot;
    this.account = account;
    this.storage = storage;
  }

  async sendGroupMsg(
    groupId: number,
    options: GroupPushOptions,
    messages: SendMessageSegment[],
  ): Promise<string> {
    const group = this.account.groups[String(groupId)];
    const target = group?.name ?? `群${groupId}`;
    const base = {
      account: this.account.id,
      targetId: group?.openid ?? String(groupId),
      target,
      purpose: options.purpose,
      purposeLabel: options.label ?? PUSH_PURPOSE_LABELS[options.purpose],
      pushedAt: new Date().toISOString(),
      content: options.content ?? null,
      subject: options.subject ?? null,
    };
    try {
      if (!group) throw new Error(`群 ${groupId} 未配置官方 group_openid 映射。`);
      const converted = this.convert(messages);
      const destination = { scope: "group" as const, targetId: group.openid };
      if (converted.image) {
        const result = await this.bot.sendImage(destination, converted.image, {
          content: converted.text,
        });
        if (!result.message) throw new Error("官方 QQ 图片已上传，但消息未发送。");
      } else {
        if (!converted.text.trim()) throw new Error("官方 QQ 消息内容为空。");
        await this.bot.sendText(destination, converted.text);
      }
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

  private convert(messages: SendMessageSegment[]) {
    let text = "";
    let image: { url?: string; localPath?: string; buffer?: Buffer } | undefined;
    for (const message of messages) {
      if (message.type === "text") {
        text += message.data.text;
      } else if (message.type === "image") {
        if (image) throw new Error("官方 QQ 单条消息仅支持一张图片。");
        const file = message.data.file;
        image = /^https?:\/\//.test(file)
          ? { url: file }
          : file.startsWith("base64://")
            ? { buffer: Buffer.from(file.slice(9), "base64") }
            : { localPath: file.startsWith("file://") ? fileURLToPath(file) : file };
      } else if (message.type === "at" && message.data.qq === "all") {
        if (!this.warnedAtAll) {
          this.logger.warn("[官方 QQ] 当前群消息接口不提供 OneBot @全体成员，已省略 {@all} 标记。");
          this.warnedAtAll = true;
        }
      } else {
        throw new Error(`官方 QQ 通道不支持消息段 ${message.type}。`);
      }
    }
    return { text: text.trim(), image };
  }

  private record(input: Parameters<typeof writePushLog>[0]) {
    try {
      writePushLog(input, this.storage);
    } catch (error) {
      this.logger.error("[官方 QQ] 写入推送记录失败", error);
    }
  }
}
