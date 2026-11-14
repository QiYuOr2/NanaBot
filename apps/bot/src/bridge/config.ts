import { readConfig } from "@nana/config";
import { z } from "zod";

/** Rei 桥接配置：只对指定账号的私聊生效。 */
export interface BridgeConfig {
  accountId: string;
}

const BridgeSchema = z.object({
  bridge: z
    .object({
      enabled: z.boolean().optional(),
      accountId: z.string().min(1).optional(),
    })
    .optional(),
});

/** 读取桥接配置；未启用或未指定账号时返回 undefined（功能静默关闭）。 */
export function loadBridgeConfig(): BridgeConfig | undefined {
  const config = BridgeSchema.parse(readConfig());
  if (!config.bridge?.enabled || !config.bridge.accountId) {
    return undefined;
  }
  return { accountId: config.bridge.accountId };
}
