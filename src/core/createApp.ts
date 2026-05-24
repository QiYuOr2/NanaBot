import { NCWebsocket, Structs, type EventHandleMap, type EventKey, type NCWebsocketOptions } from "node-napcat-ts";
import { createCleanupManager, type Cleanup, type MaybePromise } from "./event.js";
import type { FeatureContext, FeatureDefinition } from "./feature.js";

export interface CreateAppOptions {
  websocket: NCWebsocketOptions;
  adminGroupId?: number;
}

export interface StopOptions {
  announce?: string;
}

export interface App {
  ws: NCWebsocket;
  adminGroupId?: number;
  use<TOptions>(feature: FeatureDefinition<TOptions>, options: TOptions): App;
  on<T extends EventKey>(event: T, handler: EventHandleMap[T]): () => void;
  onCleanup(cleanup: Cleanup): void;
  sendAdminText(text: string): Promise<void>;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
}

type AppState = "idle" | "starting" | "started" | "stopping" | "stopped";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export function createApp(options: CreateAppOptions): App {
  const ws = new NCWebsocket(options.websocket);
  const cleanupManager = createCleanupManager();
  const pluginTasks: Promise<void>[] = [];
  let state: AppState = "idle";
  let stopTask: Promise<void> | undefined;

  const featureContext: FeatureContext = {
    ws,
    adminGroupId: options.adminGroupId,
    on(event, handler) {
      const unsubscribe = ws.subscribe(event, handler);
      cleanupManager.add(() => {
        unsubscribe();
      });
      return unsubscribe;
    },
    onCleanup(cleanup) {
      cleanupManager.add(cleanup);
    },
    async sendAdminText(text) {
      if (!options.adminGroupId) {
        return;
      }

      await ws.send_group_msg({
        group_id: options.adminGroupId,
        message: [Structs.text(text)],
      });
    },
  };

  const app: App = {
    ws,
    adminGroupId: options.adminGroupId,
    use(feature, featureOptions) {
      if (state !== "idle") {
        throw new Error("必须在 app.start() 之前注册功能。");
      }

      pluginTasks.push(
        Promise.resolve(feature.setup(featureContext, featureOptions)).then((cleanup) => {
          cleanupManager.add(cleanup);
        }),
      );

      return app;
    },
    on(event, handler) {
      return featureContext.on(event, handler);
    },
    onCleanup(cleanup) {
      featureContext.onCleanup(cleanup);
    },
    async sendAdminText(text) {
      await featureContext.sendAdminText(text);
    },
    async start() {
      if (state === "started") {
        return;
      }

      if (state !== "idle") {
        throw new Error(`当前状态为 "${state}"，无法启动应用。`);
      }

      state = "starting";
      await Promise.all(pluginTasks);
      registerSignalHandlers(app, cleanupManager);
      await ws.connect();
      state = "started";
    },
    async stop(stopOptions) {
      if (state === "stopped") {
        return;
      }

      if (stopTask) {
        return stopTask;
      }

      stopTask = (async () => {
        state = "stopping";

        if (stopOptions?.announce) {
          await safely(() => app.sendAdminText(stopOptions.announce!));
        }

        await safely(() => cleanupManager.run());
        await safely(() => ws.disconnect());
        state = "stopped";
      })();

      return stopTask;
    },
  };

  return app;
}

function registerSignalHandlers(app: App, cleanupManager: ReturnType<typeof createCleanupManager>) {
  for (const signal of SIGNALS) {
    const handler = () => {
      app
        .stop({
          announce: `我溜了~`,
        })
        .catch((error) => {
          console.error("[app] 关闭应用时发生错误", error);
        });
    };

    process.on(signal, handler);
    cleanupManager.add(() => {
      process.off(signal, handler);
    });
  }
}

async function safely(task: () => Promise<void>) {
  try {
    await task();
  } catch (error) {
    console.error("[app] 执行清理任务时发生错误", error);
  }
}
