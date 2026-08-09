import { NCWebsocket, type SendMessageSegment, type EventHandleMap, type EventKey, type NCWebsocketOptions } from "node-napcat-ts";
import { createCleanupManager, type Cleanup } from "./event";
import type { FeatureContext, FeatureDefinition } from "./feature";
import { createDefaultMessengerFactory, type MessengerFactory } from "./messenger";
import { readOptionalNumberEnv } from "../lib/utils";

export interface CreateAppOptions {
  websocket: NCWebsocketOptions;
  adminGroupId?: number;
  messengerFactory?: MessengerFactory;
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
  sendAdminMsg(messages: SendMessageSegment[]): Promise<void>;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
}

type AppState = "idle" | "starting" | "started" | "stopping" | "stopped";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export function createApp(options: CreateAppOptions): App {
  const isOpenDebug = readOptionalNumberEnv('NC_DEBUG') === 1
  isOpenDebug && console.log(`[NanaBot] 调试模式`)

  const napcat = new NCWebsocket(
    options.websocket,
    isOpenDebug
  );
  console.log(`[NanaBot] ${(options.websocket as any)['baseUrl']}`)

  const cleanupManager = createCleanupManager();
  const pluginTasks: Promise<void>[] = [];
  let state: AppState = "idle";
  let stopTask: Promise<void> | undefined;

  const messengerFactory = options.messengerFactory ?? createDefaultMessengerFactory();
  const messenger = messengerFactory.createMessenger({
    adminGroupId: options.adminGroupId,
    napcat: {
      async sendGroupMsg(payload) {
        await napcat.send_group_msg(payload);
      },
    },
  });

  const featureContext: FeatureContext = {
    adminGroupId: options.adminGroupId,
    messenger,
    on(event, handler) {
      const unsubscribe = napcat.subscribe(event, handler);
      cleanupManager.add(() => {
        unsubscribe();
      });
      return unsubscribe;
    },
    onCleanup(cleanup) {
      cleanupManager.add(cleanup);
    },
  };

  const app: App = {
    ws: napcat,
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
      await featureContext.messenger.sendAdminText(text);
    },
    async sendAdminMsg(messages) {
      await featureContext.messenger.sendAdminMsg(messages);
    },
    async start() {
      console.log(`[NanaBot] start() state === ${state}`)
      if (state === "started") {
        return;
      }

      if (state !== "idle") {
        throw new Error(`当前状态为 "${state}"，无法启动应用。`);
      }

      state = "starting";
      await Promise.all(pluginTasks);
      console.log(`[NanaBot] 插件注册数量：${pluginTasks.length}`)
      registerSignalHandlers(app, cleanupManager);
      await napcat.connect();
      state = "started";
      console.log(`[NanaBot] Connected state === ${state}`)
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
        await safely(() => napcat.disconnect());
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
          console.error("[NanaBot] 关闭应用时发生错误", error);
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
    console.error("[NanaBot] 执行清理任务时发生错误", error);
  }
}
