import type { NCWebsocket, EventHandleMap, EventKey } from "node-napcat-ts";
import type { Cleanup, MaybePromise } from "./event.js";

export interface FeatureContext {
  ws: NCWebsocket;
  adminGroupId?: number;
  on<T extends EventKey>(event: T, handler: EventHandleMap[T]): () => void;
  onCleanup(cleanup: Cleanup): void;
  sendAdminText(text: string): Promise<void>;
}

export interface FeatureDefinition<TOptions> {
  name: string;
  setup(context: FeatureContext, options: TOptions): MaybePromise<void | Cleanup>;
}

export function defineFeature<TOptions>(feature: FeatureDefinition<TOptions>) {
  return feature;
}
