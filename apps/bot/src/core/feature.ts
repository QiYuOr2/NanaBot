import type { Cleanup, MaybePromise } from "./event";
import type { Logger } from "./logger";
import type { GroupPushOptions, PushPurposeInput } from "./napcat";
import type {
  IncomingMessage,
  MessageTarget,
  OutgoingMessage,
  PlatformConnectionState,
} from "../message/types.ts";
import type { MessagePart } from "../message/parts.ts";

export interface FeatureContext {
  accountId: string;
  adminGroupId?: number;
  logger: Logger;
  onConnectionState(handler: (state: PlatformConnectionState) => void): () => void;
  onHeartbeat?(handler: (online: boolean) => void): () => void;
  onCleanup(cleanup: Cleanup): void;
  onMessage(handler: (message: IncomingMessage) => void | Promise<void>): () => void;
  replyMessage(message: IncomingMessage, response: OutgoingMessage): Promise<void>;
  sendMessage(target: MessageTarget, message: OutgoingMessage): Promise<void>;
  sendAdminText(text: string, purpose?: PushPurposeInput): Promise<void>;
  sendAdminMsg(messages: MessagePart[], purpose?: PushPurposeInput): Promise<void>;
  sendGroupMsg(
    groupId: number,
    options: GroupPushOptions,
    messages: MessagePart[],
  ): Promise<string>;
}

export interface FeatureDefinition<TOptions> {
  name: string;
  setup(context: FeatureContext, options: TOptions): MaybePromise<void | Cleanup>;
}

export function defineFeature<TOptions>(feature: FeatureDefinition<TOptions>) {
  return feature;
}
