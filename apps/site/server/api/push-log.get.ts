import { defineEventHandler } from "h3";
import { readPushLogs } from "@nana/storage";

export default defineEventHandler(() => {
  const logs = readPushLogs({}, 20);

  return { logs };
});
