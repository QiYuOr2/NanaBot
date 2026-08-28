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
