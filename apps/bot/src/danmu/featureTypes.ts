import type { MonitorStreamerConfig } from "../monitor/config.ts";
import type { StorageOptions } from "@nana/storage";
import type { WordCloudConfig } from "./config.ts";
import type { DanmuRecorder } from "./recorder.ts";
import type { AdminSender } from "./types.ts";

/** 判断主播是否在播，抽出来便于测试注入。 */
export type LiveStatusChecker = (streamer: MonitorStreamerConfig) => Promise<boolean>;

export interface WordCloudFeatureOptions extends StorageOptions {
  /** 需要录制弹幕的主播（与直播监控配置一致）。 */
  streamers: MonitorStreamerConfig[];
  /**
   * 词云推送目标群，来自 `wordcloud.notifyGroupId`，缺省为 `ADM_GROUP`。
   * 有值才推送；真正发到哪个群由 `sendAdminMsg` 决定。
   */
  notifyGroupId?: number;
  config: WordCloudConfig;
  /** B 站直播 API 的 fetch 注入点，便于测试。 */
  fetch?: typeof globalThis.fetch;
  /** 判断主播是否在播，缺省走 B 站接口；轮询兜底与启动恢复共用。 */
  isLive?: LiveStatusChecker;
  /** 测试注入的发送函数；缺省时沿用 bot 上下文。 */
  sendAdminMsg?: AdminSender;
  /** 定时器是否 unref（默认 true，避免拖住进程退出）。 */
  unrefTimers?: boolean;
  /**
   * 与 sink 工厂共用的录制器表。
   *
   * 录制器在监控启动时才写入。必须传同一个 `Map`，不能在 `app.use` 时把当时的内容拷成数组。
   */
  recorders?: Map<number, DanmuRecorder>;
}

export interface ResumeDanmuOptions extends WordCloudFeatureOptions {
  /** 时钟注入点，便于测试。 */
  now?: () => Date;
}
