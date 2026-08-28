import {
  NCWebsocket,
  type SendMessageSegment,
  Structs,
  type EventHandleMap,
  type EventKey,
  type NCWebsocketOptions,
} from "node-napcat-ts";
import { createCleanupManager, type Cleanup } from "./event";
import type { FeatureContext, FeatureDefinition } from "./feature";
import { readOptionalNumberEnv } from "@nana/utils";
import { ENV_KEYS } from "@nana/constants";
import type { StorageOptions } from "@nana/storage";
import { NapcatPushClient, type GroupPushOptions, type PushPurposeInput } from "./napcat";

export interface CreateAppOptions {
  websocket: NCWebsocketOptions;
  adminGroupId?: number;
  /** 推送记录的存储配置（测试时可传 rootDir 隔离）。 */
  storage?: StorageOptions;
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
  sendAdminText(text: string, purpose?: PushPurposeInput): Promise<void>;
  sendAdminMsg(messages: SendMessageSegment[], purpose?: PushPurposeInput): Promise<void>;
  sendGroupMsg(
    groupId: number,
    options: GroupPushOptions,
    messages: SendMessageSegment[],
  ): Promise<string>;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
}

type AppState = "idle" | "starting" | "started" | "stopping" | "stopped";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
const DEFAULT_ADMIN_PURPOSE: PushPurposeInput = { purpose: "notification" };
const BOT_NAME = "NanaBot";

export function createApp(options: CreateAppOptions): App {
  const isOpenDebug = readOptionalNumberEnv(ENV_KEYS.NC_DEBUG) === 1;
  // oxlint-disable-next-line no-unused-expressions
  isOpenDebug && console.log(`[NanaBot] 调试模式`);

  const napcat = new NCWebsocket(options.websocket, isOpenDebug);
  console.log(`[NanaBot] ${(options.websocket as any)["baseUrl"]}`);
  const pushClient = new NapcatPushClient(napcat, options.storage);

  const cleanupManager = createCleanupManager();
  const pluginTasks: Promise<void>[] = [];
  let state: AppState = "idle";
  let stopTask: Promise<void> | undefined;

  const featureContext: FeatureContext = {
    ws: napcat,
    adminGroupId: options.adminGroupId,
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
    async sendAdminText(text, purpose = DEFAULT_ADMIN_PURPOSE) {
      if (!options.adminGroupId) {
        return;
      }

      await pushClient.sendGroupMsg(
        options.adminGroupId,
        { ...purpose, content: text, subject: BOT_NAME },
        [Structs.text(text)],
      );
    },
    async sendAdminMsg(messages, purpose = DEFAULT_ADMIN_PURPOSE) {
      if (!options.adminGroupId) {
        return;
      }

      await pushClient.sendGroupMsg(
        options.adminGroupId,
        { ...purpose, subject: BOT_NAME },
        messages,
      );
    },
    async sendGroupMsg(groupId, groupOptions, messages) {
      return pushClient.sendGroupMsg(groupId, groupOptions, messages);
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
    async sendAdminText(text, purpose) {
      await featureContext.sendAdminText(text, purpose);
    },
    async sendAdminMsg(messages, purpose) {
      await featureContext.sendAdminMsg(messages, purpose);
    },
    async sendGroupMsg(groupId, options, messages) {
      return featureContext.sendGroupMsg(groupId, options, messages);
    },
    async start() {
      console.log(`[NanaBot] start() state === ${state}`);
      if (state === "started") {
        return;
      }

      if (state !== "idle") {
        throw new Error(`当前状态为 "${state}"，无法启动应用。`);
      }

      state = "starting";
      await Promise.all(pluginTasks);
      console.log(`[NanaBot] 插件注册数量：${pluginTasks.length}`);
      registerSignalHandlers(app, cleanupManager);
      await napcat.connect();
      state = "started";
      console.log(`[NanaBot] Connected state === ${state}`);
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
          await safely(() => app.sendAdminText(stopOptions.announce!, { purpose: "app.offline" }));
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
