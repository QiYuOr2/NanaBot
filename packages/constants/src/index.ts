/**
 * NanaBot 各子项目间共享的公共常量。
 *
 * 这里集中存放项目级文件/目录标识、默认网络地址、环境变量名等，
 * 供 apps/* 与 packages/* 统一引用，避免字符串散落重复。
 */

/** 项目根目录 / 配置文件标识，@nana/config 与 @nana/storage 共用。 */
export const NANA_CONFIG_FILE = "nana.config.yaml";

/** 项目的运行时数据库目录，位于项目根目录下。 */
export const DATABASE_DIRECTORY = "db";

/** 直播状态的 SQLite 数据库文件名。 */
export const LIVE_STATUS_FILE = "live-status.sqlite";

/** 推送记录的 SQLite 数据库文件名。 */
export const PUSH_LOG_FILE = "push-log.sqlite";

/** 应用自身状态（如机器人在线/离线）的 SQLite 数据库文件名。 */
export const APP_STATE_FILE = "app-state.sqlite";

/** 推送目的的事件名，用于标记一次推送的类型。 */
export const PUSH_LOG_PURPOSES = [
  "live.start",
  "live.end",
  "app.online",
  "app.offline",
  "notification",
] as const;

/** 推送目的的类型。 */
export type PushLogPurpose = (typeof PUSH_LOG_PURPOSES)[number];

/** 推送目的对应的中文展示名。 */
export const PUSH_PURPOSE_LABELS: Record<PushLogPurpose, string> = {
  "live.start": "开播",
  "live.end": "下播",
  "app.online": "上线",
  "app.offline": "下线",
  notification: "通知",
};

/** NapCat WebSocket 的默认地址。 */
export const DEFAULT_NC_WS_URL = "ws://127.0.0.1:1111";

/** 应用与环境文件使用的环境变量名。 */
export const ENV_KEYS = {
  ADM_GROUP: "ADM_GROUP",
  BARK_KEY: "BARK_KEY",
  NC_WS_URL: "NC_WS_URL",
  NC_ACCESS_TOKEN: "NC_ACCESS_TOKEN",
  NC_DEBUG: "NC_DEBUG",
  SERVER_EMAIL: "SERVER_EMAIL",
  SERVER_EMAIL_PASSWORD: "SERVER_EMAIL_PASSWORD",
} as const;

/** Bark 推送服务地址。 */
export const BARK_BASE_URL = "https://api.day.app/";

/** Bark 通知使用的应用图标地址。 */
export const BARK_ICON_URL = "https://unavatar.io/github/qiyuor2";
