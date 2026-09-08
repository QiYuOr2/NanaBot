import { readConfig } from "@nana/config";
import { z } from "zod";
import type { EmailNotifierOptions } from "@nana/notify";

/** 离线检测 + 邮件通知的完整配置。 */
export interface OfflineDetectorConfig {
  notifier: EmailNotifierOptions;
  confirmCount: number;
  notifyRecovery: boolean;
}

const OfflineMonitorSchema = z.object({
  adminEmail: z.object({
    address: z.string(),
    cc: z.array(z.string()).optional(),
    smtp: z
      .object({
        host: z.string().optional(),
        port: z.number().optional(),
        secure: z.boolean().optional(),
      })
      .optional(),
  }),
  offlineDetector: z
    .object({
      confirmCount: z.number().int().positive().optional(),
      notifyRecovery: z.boolean().optional(),
    })
    .optional(),
});

/** 读取离线检测 + 邮件配置；缺少 adminEmail 时抛出异常。 */
export function loadOfflineDetectorConfig(): OfflineDetectorConfig {
  const config = OfflineMonitorSchema.parse(readConfig());

  return {
    notifier: {
      address: config.adminEmail.address,
      cc: config.adminEmail.cc,
      smtp: config.adminEmail.smtp,
    },
    confirmCount: config.offlineDetector?.confirmCount ?? 3,
    notifyRecovery: config.offlineDetector?.notifyRecovery ?? true,
  };
}
