import type { NCWebsocket, SendMessageSegment } from "node-napcat-ts";
import { writePushLog, type StorageOptions } from "@nana/storage";
import { PUSH_PURPOSE_LABELS, type PushLogPurpose } from "@nana/constants";
import { consoleLogger, type Logger } from "./logger";

/** 解析群昵称的最长等待时间；超时后用「群+ID」照常发送消息。 */
export const DEFAULT_GROUP_NAME_TIMEOUT_MS = 5_000;

/** 一次推送的目的参数：稳定标识 + 展示名。 */
export interface PushPurposeInput {
  purpose: PushLogPurpose;
  /** 展示名，缺省时按 purpose 从常量推导。 */
  label?: string;
}

/** 群推送参数，在目的基础上附加上下文摘要。 */
export interface GroupPushOptions extends PushPurposeInput {
  /** 推送内容摘要（用于前端时间轴展示）。 */
  content?: string;
  /** 推送主体（主播名等），用于前端头像 / 文案展示。 */
  subject?: string;
}

export interface NapcatPushClientOptions extends StorageOptions {
  /** 发送消息的 NapCat 账号 id，写入推送记录。 */
  account?: string;
  /** 预置的群昵称缓存，避免每次发送都调用 get_group_info。 */
  groupNames?: Map<number, string>;
  /** 群昵称解析超时；超时不会阻塞消息发送，默认 5000ms。 */
  groupNameTimeoutMs?: number;
  /** 当前账号的日志出口。 */
  logger?: Logger;
}

/**
 * 封装 NapCat 的群消息发送：
 * - 通过 get_group_info 解析群昵称（失败时回退到「群+ID」）。
 * - 每次发送后都写入一条推送记录，无论成功还是失败。
 */
export class NapcatPushClient {
  private readonly ws: NCWebsocket;
  private readonly account?: string;
  private readonly groupNames: Map<number, string>;
  private readonly groupNameTimeoutMs: number;
  private readonly storageOptions: StorageOptions;
  private readonly logger: Logger;

  constructor(ws: NCWebsocket, options: NapcatPushClientOptions = {}) {
    this.ws = ws;
    this.account = options.account;
    this.groupNames = options.groupNames ?? new Map();
    this.groupNameTimeoutMs = options.groupNameTimeoutMs ?? DEFAULT_GROUP_NAME_TIMEOUT_MS;
    this.storageOptions = options;
    this.logger = options.logger ?? consoleLogger;
  }

  /** 解析群昵称；get_group_info 失败时回退到「群+ID」。 */
  async resolveGroupName(groupId: number): Promise<string> {
    const cached = this.groupNames.get(groupId);
    if (cached) {
      return cached;
    }

    try {
      const info = await withTimeout(
        this.ws.get_group_info({ group_id: groupId }),
        this.groupNameTimeoutMs,
      );
      const name = info.group_name || `群${groupId}`;
      this.groupNames.set(groupId, name);
      return name;
    } catch (error) {
      this.logger.warn(`[推送] 解析群 ${groupId} 昵称失败，将使用「群${groupId}」继续发送`, error);
      return `群${groupId}`;
    }
  }

  /**
   * 发送群消息，并记录一条推送记录。
   * 发送失败时会抛出原始错误，供调用方决定是否额外通知。
   */
  async sendGroupMsg(
    groupId: number,
    options: GroupPushOptions,
    messages: SendMessageSegment[],
  ): Promise<string> {
    const target = await this.resolveGroupName(groupId);
    const purposeLabel = options.label ?? PUSH_PURPOSE_LABELS[options.purpose];
    const base = {
      account: this.account ?? null,
      targetId: String(groupId),
      target,
      purpose: options.purpose,
      purposeLabel,
      pushedAt: new Date().toISOString(),
      content: options.content ?? null,
      subject: options.subject ?? null,
    };

    try {
      await this.ws.send_group_msg({ group_id: groupId, message: messages });
      this.record({ ...base, success: true });
    } catch (error) {
      this.record({
        ...base,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return target;
  }

  private record(log: Parameters<typeof writePushLog>[0]): void {
    try {
      writePushLog(log, this.storageOptions);
    } catch (error) {
      this.logger.error("[推送记录] 写入推送日志失败", error);
    }
  }
}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    task,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`解析群昵称超过 ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}
