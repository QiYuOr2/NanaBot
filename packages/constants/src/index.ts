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
export const LOG_DIRECTORY = "logs";

/** 直播状态的 SQLite 数据库文件名。 */
export const LIVE_STATUS_FILE = "live-status.sqlite";

/** 推送记录的 SQLite 数据库文件名。 */
export const PUSH_LOG_FILE = "push-log.sqlite";

/** 应用自身状态（如机器人在线/离线）的 SQLite 数据库文件名。 */
export const APP_STATE_FILE = "app-state.sqlite";

/** 弹幕场次与逐条弹幕的 SQLite 数据库文件名。 */
export const DANMU_FILE = "danmu.sqlite";
export const QQ_GROUP_FILE = "qq-group.sqlite";

/** 推送目的的事件名，用于标记一次推送的类型。 */
export const PUSH_LOG_PURPOSES = [
  "live.start",
  "live.end",
  "app.online",
  "app.offline",
  "wordcloud",
  "live.summary",
  "notification",
  "message.test",
  "message.command",
  "message.auto-reply",
] as const;

/** 推送目的的类型。 */
export type PushLogPurpose = (typeof PUSH_LOG_PURPOSES)[number];

/** 推送目的对应的中文展示名。 */
export const PUSH_PURPOSE_LABELS: Record<PushLogPurpose, string> = {
  "live.start": "开播",
  "live.end": "下播",
  "app.online": "上线",
  "app.offline": "下线",
  wordcloud: "词云",
  "live.summary": "直播摘要",
  notification: "通知",
  "message.test": "测试消息",
  "message.command": "命令回复",
  "message.auto-reply": "自动回复",
};

/** QQ 连接通道的展示名称。 */
export const QQ_PROVIDER_LABELS = { official: "官方 API", napcat: "NapCat" } as const;

/** 应用与环境文件使用的环境变量名。 */
export const ENV_KEYS = {
  BARK_KEY: "BARK_KEY",
  NC_WS_URL: "NC_WS_URL",
  NC_ACCESS_TOKEN: "NC_ACCESS_TOKEN",
  NC_DEBUG: "NC_DEBUG",
  QQ_BOT_APP_ID: "QQ_BOT_APP_ID",
  QQ_BOT_APP_SECRET: "QQ_BOT_APP_SECRET",
  NANA_SITE_CONFIG_TOKEN: "NANA_SITE_CONFIG_TOKEN",
  NANA_AUTH_TOKEN: "NANA_AUTH_TOKEN",
  NANA_BOT_CONTROL_PORT: "NANA_BOT_CONTROL_PORT",
  NANA_BOT_CONTROL_URL: "NANA_BOT_CONTROL_URL",
  SERVER_EMAIL: "SERVER_EMAIL",
  SERVER_EMAIL_PASSWORD: "SERVER_EMAIL_PASSWORD",
  /** DeepSeek 直播摘要。机器人与站点补生成都读这个变量。 */
  DEEPSEEK_API_KEY: "DEEPSEEK_API_KEY",
} as const;

/** bot 内部控制接口：仅监听本机，site 通过同一管理口令调用。 */
export const BOT_CONTROL_DEFAULT_PORT = 6365;
export const BOT_CONTROL_DEFAULT_URL = `http://127.0.0.1:${BOT_CONTROL_DEFAULT_PORT}`;
export const BOT_CONTROL_TEST_MESSAGE_PATH = "/api/qq/test-message";

/** Bark 推送服务地址。 */
export const BARK_BASE_URL = "https://api.day.app/";

/** Bark 通知使用的应用图标地址。 */
export const BARK_ICON_URL = "https://unavatar.io/github/qiyuor2";

/**
 * 直播摘要的固定说明。
 *
 * 群消息和词云页都带上这一句，标明正文是从弹幕推断的，不是直播内容本身。
 */
export const LIVE_SUMMARY_DISCLAIMER = "根据弹幕推断，不是直播内容本身";
