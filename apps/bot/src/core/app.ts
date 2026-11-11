import type { FeatureContext, FeatureDefinition } from "./feature";

/** 业务编排共用的应用接口，具体连接由各 QQ 通道管理。 */
export interface BotApp extends Pick<
  FeatureContext,
  "accountId" | "adminGroupId" | "onCleanup" | "sendAdminText" | "sendAdminMsg" | "sendGroupMsg"
> {
  use<T>(feature: FeatureDefinition<T>, options: T): BotApp;
  onConnected(handler: () => void): () => void;
  start(): Promise<void>;
  stop(options?: { announce?: string }): Promise<void>;
}
