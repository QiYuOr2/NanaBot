import { defineEventHandler } from "h3";
import { buildStreamerStatuses } from "../utils/streamers.ts";

export default defineEventHandler(() => {
  const streamers = buildStreamerStatuses();

  return {
    streamers,
    generatedAt: new Date().toISOString(),
    total: streamers.length,
    liveCount: streamers.filter((item) => item.live).length,
  };
});
