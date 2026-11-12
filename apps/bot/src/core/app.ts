import type { FeatureContext, FeatureDefinition } from "./feature";
import type { PlatformConnectionState } from "../message/types.ts";

/** 业务编排共用的应用接口，具体连接由各 QQ 通道管理。 */
export interface BotApp extends Pick<
  FeatureContext,
  | "accountId"
  | "adminGroupId"
  | "onCleanup"
  | "sendAdminText"
  | "sendAdminMsg"
  | "sendGroupMsg"
  | "onMessage"
  | "replyMessage"
  | "onConnectionState"
  | "onHeartbeat"
  | "sendMessage"
> {
  readonly connected: boolean;
  use<T>(feature: FeatureDefinition<T>, options: T): BotApp;
  onConnected(handler: () => void): () => void;
  onConnectionState(handler: (state: PlatformConnectionState) => void): () => void;
  onMessage(
    handler: (message: import("../message/types.ts").IncomingMessage) => void | Promise<void>,
  ): () => void;
  replyMessage(
    message: import("../message/types.ts").IncomingMessage,
    response: import("../message/types.ts").MessageReply,
  ): Promise<void>;
  start(): Promise<void>;
  stop(options?: { announce?: string }): Promise<void>;
}
