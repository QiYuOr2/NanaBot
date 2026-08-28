import type { PushLogPurpose } from "@nana/storage";

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

export type { PushLogPurpose };

export interface PushLogItem {
  id: number;
  /** 推送目标群 ID（字符串）。 */
  targetId: string;
  /** 推送目标可读名称（群昵称）。 */
  target: string;
  purpose: PushLogPurpose;
  purposeLabel: string;
  pushedAt: string;
  success: boolean;
  error: string | null;
  content: string | null;
  subject: string | null;
}

export interface PushLogResponse {
  logs: PushLogItem[];
}
