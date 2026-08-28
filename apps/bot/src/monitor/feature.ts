import { createBliveMonitorSource, createMonitor, type MonitorFeatureOptions } from "@nana/monitor";
import { dateFormat } from "@nana/utils";
import { defineFeature, type FeatureContext } from "../core";
import { createLiveStatusSink, createNapcatMonitorSink } from "./sinks";

export type { MonitorFeatureOptions } from "@nana/monitor";

export const monitorFeature = defineFeature<MonitorFeatureOptions>({
  name: "直播监控",
  setup(context: FeatureContext, options) {
    const monitor = createMonitor({
      ...options,
      source: createBliveMonitorSource(),
      sinks: [
        createLiveStatusSink({ uid: options.uid }),
        createNapcatMonitorSink(context, options.notifyGroupIds, options.notifyEnabled),
      ],
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
