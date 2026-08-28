import { readConfig } from "@nana/config";
import { readAllLiveStatus } from "@nana/storage";
import { defineEventHandler } from "h3";
import { z } from "zod";

const UpSchema = z.object({
  live: z.boolean().optional().default(true),
  liveRoomId: z.number().int(),
  uname: z.string().min(1),
});

const ConfigSchema = z.object({
  up: z.array(UpSchema).optional().default([]),
});

export default defineEventHandler(() => {
  const config = ConfigSchema.parse(readConfig());
  const statuses = readAllLiveStatus();
  const statusByRoom = new Map(statuses.map((status) => [status.roomId, status]));

  const streamers = config.up
    .filter((entry) => entry.live)
    .map((entry) => {
      const status = statusByRoom.get(String(entry.liveRoomId));
      return {
        streamer: entry.uname,
        roomId: entry.liveRoomId,
        live: status?.live ?? false,
        updatedAt: status?.updatedAt ?? null,
      };
    });

  return {
    streamers,
    generatedAt: new Date().toISOString(),
    total: streamers.length,
    liveCount: streamers.filter((item) => item.live).length,
  };
});
