import type { NCWebsocket, EventHandleMap, EventKey, SendMessageSegment } from "node-napcat-ts";
import type { Cleanup, MaybePromise } from "./event";
import type { Logger } from "./logger";
import type { GroupPushOptions, PushPurposeInput } from "./napcat";

export interface FeatureContext {
  /** 仅 NapCat 通道提供原始连接。业务功能应使用发送方法。 */
  ws?: NCWebsocket;
  /** 当前 QQ 通道的账号 id；NapCat 单账号 legacy 部署为 `default`。 */
  accountId?: string;
  adminGroupId?: number;
  /** 当前账号的日志出口；运行时按账号写入独立文件。 */
  logger: Logger;
  on?<T extends EventKey>(event: T, handler: EventHandleMap[T]): () => void;
  /** 官方通道的连接状态；不伪造 OneBot 心跳。 */
  onConnectionState?(handler: (connected: boolean) => void): () => void;
  onCleanup(cleanup: Cleanup): void;
  sendAdminText(text: string, purpose?: PushPurposeInput): Promise<void>;
  sendAdminMsg(messages: SendMessageSegment[], purpose?: PushPurposeInput): Promise<void>;
  sendGroupMsg(
    groupId: number,
    options: GroupPushOptions,
    messages: SendMessageSegment[],
  ): Promise<string>;
}

export interface FeatureDefinition<TOptions> {
  name: string;
  setup(context: FeatureContext, options: TOptions): MaybePromise<void | Cleanup>;
}

export function defineFeature<TOptions>(feature: FeatureDefinition<TOptions>) {
  return feature;
}
