export interface StreamerStatus {
  streamer: string;
  roomId: number;
  live: boolean;
  title: string | null;
  area: string | null;
  viewer: number | null;
  updatedAt: string | null;
}

export interface LiveStatusResponse {
  streamers: StreamerStatus[];
  generatedAt: string;
  total: number;
  liveCount: number;
}

/** 顶栏面包屑的一项；当前页不传 `to`。 */
export interface HeaderTrailItem {
  label: string;
  /** 可点击跳转的目标路由。 */
  to?: string;
}

export type { BotAlertItem, BotAlertsResponse, BotAlertState } from "#shared/alerts";
export type { PushLogPurpose } from "@nana/storage";
export type {
  PushActivity,
  PushActivityFailure,
  PushActivitySummary,
  PushActivityTarget,
  PushLogItem,
  PushLogResponse,
  PushTargetStatus,
} from "#shared/push-log";
export type {
  DanmuLiveSummaryDto,
  DanmuLiveSummaryResponse,
  DanmuMessageDto,
  DanmuSessionDetailResponse,
  DanmuSessionStatsDto,
  DanmuSessionSummaryDto,
  DanmuSessionsResponse,
  DanmuWordCloudFormat,
  DanmuWordCountDto,
} from "#shared/danmu";
