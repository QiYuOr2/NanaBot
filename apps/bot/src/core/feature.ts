import type { EventHandleMap, EventKey } from "node-napcat-ts";
import type { Cleanup, MaybePromise } from "./event";
import type { Messenger } from "./messenger";

export interface FeatureContext {
  adminGroupId?: number;
  messenger: Messenger;
  on<T extends EventKey>(event: T, handler: EventHandleMap[T]): () => void;
  onCleanup(cleanup: Cleanup): void;
}

export interface FeatureDefinition<TOptions> {
  name: string;
  setup(context: FeatureContext, options: TOptions): MaybePromise<void | Cleanup>;
}

export function defineFeature<TOptions>(feature: FeatureDefinition<TOptions>) {
  return feature;
}
