import { defineEventHandler } from "h3";
import { buildMonitorView } from "../utils/monitor.ts";

export default defineEventHandler(() => ({
  ...buildMonitorView(),
  generatedAt: new Date().toISOString(),
}));
