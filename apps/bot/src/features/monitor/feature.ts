import { createMonitor, type MonitorFeatureOptions } from "@nana/monitor";
import { dateFormat } from "@nana/utils";
import { defineFeature, type FeatureContext } from "../../core/index";
import { createBliveMonitorSource } from "./bliveSource";
import { createNapcatMonitorSink } from "./napcatSink";

export type { MonitorFeatureOptions } from "@nana/monitor";

export const monitorFeature = defineFeature<MonitorFeatureOptions>({
  name: "直播监控",
  setup(context: FeatureContext, options) {
    const monitor = createMonitor({
      ...options,
      source: createBliveMonitorSource(),
      sinks: [createNapcatMonitorSink(context, options.notifyGroupIds)],
      logger: {
        log(message) {
          console.log(`[${dateFormat(Date.now())}] ${message}`);
        },
        error(message, error) {
          console.error(message, error);
        },
      },
    });
    monitor.start();

    return () => monitor.stop();
  },
});
