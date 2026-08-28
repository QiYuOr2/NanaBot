export type StorageValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
export type StoragePath = string | readonly (string | number)[];

export interface StorageOptions {
  rootDir?: string;
}

export interface LiveStatus {
  streamer: string;
  live: boolean;
  updatedAt: string;
  /** 直播间标题（未开播或无记录时为空）。 */
  title?: string | null;
  /** 直播分区名（如“游戏 / 原神”）。 */
  area?: string | null;
  /** 当前直播间人气/观众数。 */
  viewer?: number | null;
}
