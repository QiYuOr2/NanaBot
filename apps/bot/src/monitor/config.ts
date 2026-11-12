import { readConfig } from "@nana/config";
import { z } from "zod";

export interface MonitorMessageConfig {
  liveStart: string;
  liveEnd: string;
}

/** 某个主播自己的词云通知。词云属于这场直播的主播，不走全局推送目标。 */
export interface StreamerWordCloudConfig {
  /** 是否为该主播录制弹幕并在下播后推送词云。 */
  enabled: boolean;
  /** 词云推送目标群。空数组表示只录制、不推送。 */
  notifyGroups: number[];
}

export interface MonitorStreamerConfig {
  uid: number;
  roomId: number;
  streamer: string;
  /** 该主播的通知由哪个 QQ 账号发送；缺省为配置的默认账号。 */
  qqAccount?: string;
  notifyEnabled: boolean;
  notifyGroups: number[];
  messages: MonitorMessageConfig;
  wordCloud: StreamerWordCloudConfig;
}

export interface MonitorConfig {
  streamers: MonitorStreamerConfig[];
}

const StreamerWordCloudConfigSchema = z.object({
  enabled: z.boolean().default(true),
  notifyGroups: z.array(z.number().int().positive()).default([]),
});

const UpMonitorConfigSchema = z.object({
  live: z.boolean(),
  liveMonitorConfig: z.object({
    enableNotify: z.boolean().default(true),
    notifyGroups: z.array(z.number().int()),
    messageTemplate: z.object({
      start: z.string(),
    }),
  }),
  /** 不写则不为该主播录制或推送词云。 */
  wordcloud: StreamerWordCloudConfigSchema.optional(),
  qqAccount: z.string().min(1).optional(),
  uid: z.number().int(),
  liveRoomId: z.number().int(),
  uname: z.string().min(1),
});

type UpMonitorConfig = z.infer<typeof UpMonitorConfigSchema>;

const NanaMonitorConfigSchema = z.object({
  up: z.array(UpMonitorConfigSchema),
});

/** 从 `nana.config.yaml` 读取直播监控配置，只保留 `live: true` 的主播。 */
export function loadMonitorConfig(): MonitorConfig {
  const config = NanaMonitorConfigSchema.parse(readConfig());

  return {
    streamers: config.up.filter((monitorConfig) => monitorConfig.live).map(toMonitorStreamerConfig),
  };
}

function toMonitorStreamerConfig(config: UpMonitorConfig): MonitorStreamerConfig {
  return {
    uid: config.uid,
    roomId: config.liveRoomId,
    streamer: config.uname,
    qqAccount: config.qqAccount,
    notifyEnabled: config.liveMonitorConfig.enableNotify,
    notifyGroups: config.liveMonitorConfig.notifyGroups,
    messages: {
      liveStart: config.liveMonitorConfig.messageTemplate.start,
      liveEnd: `${config.uname} 下播了`,
    },
    wordCloud: {
      enabled: config.wordcloud?.enabled ?? false,
      notifyGroups: config.wordcloud?.notifyGroups ?? [],
    },
  };
}
