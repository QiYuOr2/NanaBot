export type LiveStatus = 0 | 1 | 2;

export interface LiveStatusInfo {
  title: string;
  room_id: number;
  uid: number;
  online: number;
  live_time: number;
  live_status: LiveStatus;
  short_id: number;
  area: number;
  area_name: string;
  area_v2_id: number;
  area_v2_name: string;
  area_v2_parent_id: number;
  area_v2_parent_name: string;
  uname: string;
  face: string;
  tag_name: string;
  tags: string;
  cover_from_user: string;
  keyframe: string;
  lock_till: string;
  hidden_till: string;
  broadcast_type: number;
}

export interface BilibiliApiResponse<T> {
  code: number;
  message: string;
  msg?: string;
  ttl?: number;
  data: T;
}

export type LiveStatusByUidResponse = BilibiliApiResponse<Record<string, LiveStatusInfo>>;

export interface BilibiliApiOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}
