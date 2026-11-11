import type { NCWebsocket, EventHandleMap, EventKey, SendMessageSegment } from "node-napcat-ts";
import type { Cleanup, MaybePromise } from "./event";
import type { GroupPushOptions, PushPurposeInput } from "./napcat";

export interface FeatureContext {
  ws: NCWebsocket;
  /** 当前连接对应的 NapCat 账号 id；单账号 legacy 部署为 `default`。 */
  accountId?: string;
  adminGroupId?: number;
  on<T extends EventKey>(event: T, handler: EventHandleMap[T]): () => void;
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
