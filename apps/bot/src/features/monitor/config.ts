import { readConfig } from "@nana/config";
import { z } from "zod";

export interface MonitorMessageConfig {
  liveStart: string;
  liveEnd: string;
}

export interface MonitorStreamerConfig {
  roomId: number;
  streamer: string;
  notifyGroups: number[];
  messages: MonitorMessageConfig;
}

export interface MonitorConfig {
  streamers: MonitorStreamerConfig[];
}

const UpMonitorConfigSchema = z.object({
  live: z.boolean(),
  liveMonitorConfig: z.object({
    notifyGroups: z.array(z.number().int()),
    messageTemplate: z.object({
      start: z.string(),
    }),
  }),
  uid: z.number().int(),
  liveRoomId: z.number().int(),
  uname: z.string().min(1),
});

type UpMonitorConfig = z.infer<typeof UpMonitorConfigSchema>;

const NanaMonitorConfigSchema = z.object({
  up: z.array(UpMonitorConfigSchema),
});

export function loadMonitorConfig(): MonitorConfig {
  const config = NanaMonitorConfigSchema.parse(readConfig());

  return {
    streamers: config.up.filter((monitorConfig) => monitorConfig.live).map(toMonitorStreamerConfig),
  };
}

function toMonitorStreamerConfig(config: UpMonitorConfig): MonitorStreamerConfig {
  return {
    roomId: config.liveRoomId,
    streamer: config.uname,
    notifyGroups: config.liveMonitorConfig.notifyGroups,
    messages: {
      liveStart: config.liveMonitorConfig.messageTemplate.start,
      liveEnd: `${config.uname} 下播了`,
    },
  };
}
