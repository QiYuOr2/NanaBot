import type { MonitorStreamerConfig } from "../monitor/config.ts";
import type { StorageOptions } from "@nana/storage";
import type { WordCloudConfig } from "./config.ts";
import type { DanmuRecorder } from "./recorder.ts";
import type { DanmuCloseReason, WordCloudSender } from "./types.ts";

/** 判断主播是否在播，抽出来便于测试注入。 */
export type LiveStatusChecker = (streamer: MonitorStreamerConfig) => Promise<boolean>;

export interface WordCloudFeatureOptions extends StorageOptions {
  /** 直播监控里的主播。只有 `wordCloud.enabled` 的主播会录制并推送。 */
  streamers: MonitorStreamerConfig[];
  /** 分词、渲染与轮询间隔。推送目标在每个主播的 `wordCloud.notifyGroups`。 */
  config: WordCloudConfig;
  /** B 站直播 API 的 fetch 注入点，便于测试。 */
  fetch?: typeof globalThis.fetch;
  /** 判断主播是否在播，缺省走 B 站接口；轮询兜底与启动恢复共用。 */
  isLive?: LiveStatusChecker;
  /** 发到主播配置的群。配置了推送群却没注入时，建 sink 会直接失败。 */
  sendWordCloud?: WordCloudSender;
  /**
   * 场次收尾后的回调。词云推送之外的收尾（例如直播摘要）走这里，
   * 失败不应挡住词云，词云失败也不应跳过它。
   */
  onSessionClosed?: SessionClosedHandler;
  /** 定时器是否 unref（默认 true，避免拖住进程退出）。 */
  unrefTimers?: boolean;
  /**
   * 与 sink 工厂共用的录制器表。
   *
   * 录制器在监控启动时才写入。必须传同一个 `Map`，不能在 `app.use` 时把当时的内容拷成数组。
   */
  recorders?: Map<number, DanmuRecorder>;
}

/** 一场弹幕已经收尾。`streamer` 是监控配置里的完整主播，方便摘要找到开播通知群。 */
export interface SessionClosedInput {
  sessionId: number;
  streamer: MonitorStreamerConfig;
  closeReason: DanmuCloseReason;
}

export type SessionClosedHandler = (input: SessionClosedInput) => Promise<void>;

export interface ResumeDanmuOptions extends WordCloudFeatureOptions {
  /** 时钟注入点，便于测试。 */
  now?: () => Date;
}
