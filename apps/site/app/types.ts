export interface StreamerStatus {
  streamer: string;
  roomId: number;
  live: boolean;
  updatedAt: string | null;
}

export interface LiveStatusResponse {
  streamers: StreamerStatus[];
  generatedAt: string;
  total: number;
  liveCount: number;
}
