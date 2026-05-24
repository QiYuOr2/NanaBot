export type MaybePromise<T> = T | Promise<T>;

export type Cleanup = () => MaybePromise<void>;

export interface CleanupManager {
  add(cleanup?: Cleanup | void): void;
  run(): Promise<void>;
}

export function createCleanupManager(): CleanupManager {
  const cleanups: Cleanup[] = [];

  return {
    add(cleanup) {
      if (!cleanup) {
        return;
      }

      cleanups.push(cleanup);
    },
    async run() {
      const pending = cleanups.splice(0).reverse();

      for (const cleanup of pending) {
        await cleanup();
      }
    },
  };
}
