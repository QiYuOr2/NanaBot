export type StorageValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
export type StoragePath = string | readonly (string | number)[];

export interface StorageOptions {
  rootDir?: string;
}

export interface LiveStatus {
  streamer: string;
  live: boolean;
  updatedAt: string;
}
