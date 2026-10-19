import type { DanmuSessionCloseReason } from "@nana/storage";

export { loadWordCloudConfig, type WordCloudConfig } from "./config.ts";
export {
  createWordCloudMonitorSink,
  fetchIsLive,
  resumeDanmuSessions,
  wordCloudFeature,
  type LiveStatusChecker,
  type WordCloudFeatureOptions,
  type ResumeDanmuOptions,
} from "./feature.ts";
export { DEFAULT_MESSAGE_TOP_WORDS, publishWordCloud, renderWordCloudImage } from "./publish.ts";
export { createDanmuSink, DanmuRecorder, type DanmuRecorderOptions } from "./recorder.ts";
export { DanmuStore, FLUSH_BATCH_SIZE, FLUSH_INTERVAL_MS } from "./store.ts";
export {
  toAdminSender,
  type AdminSender,
  type DanmuCloseReason,
  type WordCloudPublishOptions,
} from "./types.ts";
export { buildWordCloudSummary, extractSessionWords, toWordOptions } from "./wordCloud.ts";

/** 收尾原因的中文说明，用于日志与面板展示。 */
export const CLOSE_REASON_LABELS: Record<DanmuSessionCloseReason, string> = {
  "live.ended": "正常下播",
  poll: "轮询兜底",
  shutdown: "进程退出",
  stale: "异常中断",
};
