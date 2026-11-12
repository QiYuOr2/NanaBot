import { qrConnect } from "@tencent-connect/qqbot-connector";
import type { QQCredentials } from "./types.ts";

export interface QQConnectOptions {
  source?: string;
  signal?: AbortSignal;
}

/** 官方控制台扫码授权，仅返回凭据，由调用方决定保存位置。 */
export async function connectQQRobot(options: QQConnectOptions = {}): Promise<QQCredentials[]> {
  const credentials = await qrConnect(options);
  return credentials.map(({ appId, appSecret }) => ({ appId, appSecret }));
}
