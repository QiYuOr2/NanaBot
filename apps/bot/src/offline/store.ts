import { readAppState, writeAppState, type AppStateOptions } from "@nana/storage";
import type { OfflineState, OfflineStateStore } from "@nana/offline-detector";

/** 基于 @nana/storage 的应用状态存储，隔离测试时可通过 rootDir 指定。 */
export function createOfflineStateStore(options?: AppStateOptions): OfflineStateStore {
  return {
    read() {
      return readAppState(options);
    },
    write(state: OfflineState) {
      writeAppState(state, options);
    },
  };
}
