import { createBliveMonitorSource, createMonitor, type MonitorFeatureOptions } from "@nana/monitor";
import type { MonitorSink } from "@nana/monitor";
import type { StorageOptions } from "@nana/storage";
import { dateFormat } from "@nana/utils";
import { defineFeature, type FeatureContext } from "../core";
import { createLiveStatusSink, createNapcatMonitorSink } from "./sinks";

export type { MonitorFeatureOptions } from "@nana/monitor";

/**
 * 额外挂到同一个直播间长连接上的 sink 工厂。
 *
 * 每个主播只应有一条 blive 长连接：开播通知、直播状态、弹幕录制都从同一条连接的
 * 事件流里取。需要订阅事件的其它功能（如弹幕录制）通过这里注册，不要再自建 monitor。
 */
export type MonitorSinkFactory = (streamer: MonitorFeatureOptions) => MonitorSink | undefined;

export interface MonitorFeatureRegistration extends StorageOptions {
  /** 为该主播创建额外的 sink；返回 undefined 表示该主播不参与。 */
  createSink?: MonitorSinkFactory;
}

/**
 * 创建直播监控功能。每个主播一条长连接，默认 sinks：
 * 直播状态落库 + NapCat 开播/下播通知，外加 `registration` 提供的扩展 sink。
 *
 * `rootDir` 会透传给直播状态 sink：不传时 `@nana/storage` 会退化为「从当前工作目录
 * 向上查找 `nana.config.yaml`」，pm2 的 `cwd` 一旦不是仓库内某个子目录就会找不到根。
 */
export function createMonitorFeature(registration: MonitorFeatureRegistration = {}) {
  return defineFeature<MonitorFeatureOptions>({
    name: "直播监控",
    setup(context: FeatureContext, options) {
      const sinks: MonitorSink[] = [
        createLiveStatusSink({ uid: options.uid, rootDir: registration.rootDir }),
        createNapcatMonitorSink(context, options.notifyGroupIds, options.notifyEnabled),
      ];
      const extraSink = registration.createSink?.(options);
      if (extraSink) {
        sinks.push(extraSink);
      }

      const monitor = createMonitor({
        ...options,
        source: createBliveMonitorSource(),
        sinks,
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
}
