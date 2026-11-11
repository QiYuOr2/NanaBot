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
import {
  CONNECT_TIMEOUT_MS,
  ConnectionSupervisor,
  settleWithin,
  type ConnectionSupervisorOptions,
} from "./connection";

export interface CreateAppOptions {
  websocket: NCWebsocketOptions;
  /** 当前连接对应的 NapCat 账号；多账号部署时每个 App 传一个。 */
  account?: {
    id: string;
    name?: string;
  };
  adminGroupId?: number;
  /** 推送记录的存储配置（测试时可传 rootDir 隔离）。 */
  storage?: StorageOptions;
  /** 连接看门狗的配置，缺省即启用默认值。 */
  connection?: ConnectionSupervisorOptions;
  /** 是否由 App 自己注册 SIGINT / SIGTERM；多 App 启动时由入口统一处理。 */
  handleSignals?: boolean;
}

export interface StopOptions {
  announce?: string;
}

export interface App {
  ws: NCWebsocket;
  /** 当前连接对应的 NapCat 账号 id。 */
  accountId?: string;
  /** 连接看门狗，可用 `isConnected` 观察当前连接状态。 */
  connection: ConnectionSupervisor;
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
  const logTag = options.account
    ? `[NanaBot:${options.account.name ?? options.account.id}]`
    : "[NanaBot]";
  const isOpenDebug = readOptionalNumberEnv(ENV_KEYS.NC_DEBUG) === 1;
  // oxlint-disable-next-line no-unused-expressions
  isOpenDebug && console.log(`${logTag} 调试模式`);

  const napcat = new NCWebsocket(options.websocket, isOpenDebug);
  console.log(`${logTag} ${(options.websocket as any)["baseUrl"]}`);
  const pushClient = new NapcatPushClient(napcat, {
    ...options.storage,
    account: options.account?.id,
  });
  const connection = new ConnectionSupervisor(napcat, options.connection);

  const cleanupManager = createCleanupManager();
  const pluginTasks: Promise<void>[] = [];
  let state: AppState = "idle";
  let stopTask: Promise<void> | undefined;

  const featureContext: FeatureContext = {
    ws: napcat,
    accountId: options.account?.id,
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
    accountId: options.account?.id,
    connection,
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
      console.log(`${logTag} start() state === ${state}`);
      if (state === "started") {
        return;
      }

      if (state !== "idle") {
        throw new Error(`当前状态为 "${state}"，无法启动应用。`);
      }

      state = "starting";
      await Promise.all(pluginTasks);
      console.log(`${logTag} 插件注册数量：${pluginTasks.length}`);
      if (options.handleSignals !== false) {
        registerSignalHandlers(app, cleanupManager);
      }
      // 先启动看门狗：首次连接若卡住（库的 connect() 会永不 settle），由它负责持续重连。
      connection.start();
      if (!(await settleWithin(napcat.connect(), CONNECT_TIMEOUT_MS))) {
        console.warn(
          `${logTag} 首次连接 NapCat 超过 ${CONNECT_TIMEOUT_MS}ms 未成功，改由连接看门狗持续重试。`,
        );
      }
      state = "started";
      console.log(`${logTag} Connected state === ${state}`);
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
        // 先停看门狗，避免它和后面的主动断开抢连接。
        connection.stop();

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
