import { live } from "@nana/bilibili-api";
import {
  createBliveMonitorSource,
  createMonitor,
  type MonitorController,
  type MonitorFeatureOptions,
  type MonitorSink,
} from "@nana/monitor";
import { recordDanmuSessionCutOff, type StorageOptions } from "@nana/storage";
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
  /** 共享的监控控制器表，供启动状态同步和轮询兜底查询/联动宽限期状态。 */
  monitors?: Map<number, MonitorController>;
  /** 覆盖宽限期到期时的直播状态校验，便于测试注入。 */
  checkLiveStatus?: (streamer: MonitorFeatureOptions) => Promise<boolean>;
}

/**
 * 创建直播监控功能。每个主播一条长连接，默认 sinks：
 * 直播状态落库 + 开播/恢复/超管切断通知，外加 `registration` 提供的扩展 sink。
 *
 * `rootDir` 会透传给直播状态 sink：不传时 `@nana/storage` 会退化为「从当前工作目录
 * 向上查找 `nana.config.yaml`」，pm2 的 `cwd` 一旦不是仓库内某个子目录就会找不到根。
 */
export function createMonitorFeature(registration: MonitorFeatureRegistration = {}) {
  return defineFeature<MonitorFeatureOptions>({
    name: "直播监控",
    setup(context: FeatureContext, options) {
      const sinks: MonitorSink[] = [
        createLiveStatusSink({
          uid: options.uid,
          rootDir: registration.rootDir,
          logger: context.logger,
        }),
        createNapcatMonitorSink(context, options.notifyGroupIds, options.notifyEnabled),
      ];
      const extraSink = registration.createSink?.(options);
      if (extraSink) {
        sinks.push(extraSink);
      } else {
        // 未开启弹幕词云录制时仍把超管切断落库，供站点展示。
        sinks.push(createStandaloneCutOffSink(registration.rootDir, context));
      }

      const checkLiveStatus = registration.checkLiveStatus
        ? () => registration.checkLiveStatus!(options)
        : options.uid !== undefined
          ? async () => {
              const statusByUid = await live.getLiveStatusByUids([options.uid!]);
              return statusByUid[String(options.uid)]?.live_status === 1;
            }
          : undefined;

      const monitor = createMonitor({
        ...options,
        source: createBliveMonitorSource(),
        sinks,
        checkLiveStatus,
        logger: {
          log(message) {
            context.logger.info(message);
          },
          error(message, error) {
            context.logger.error(message, error);
          },
        },
      });
      registration.monitors?.set(options.roomId, monitor);
      monitor.start();

      return async () => {
        registration.monitors?.delete(options.roomId);
        await monitor.stop();
      };
    },
  });
}

function createStandaloneCutOffSink(
  rootDir: string | undefined,
  context: FeatureContext,
): MonitorSink {
  return {
    handle(event) {
      if (event.type !== "live.cutoff") {
        return;
      }
      try {
        recordDanmuSessionCutOff(
          {
            sessionId: null,
            roomId: event.roomId,
            streamer: event.streamer,
            cutOffAt: event.timestamp.toISOString(),
            reason: event.reason,
          },
          { rootDir },
        );
      } catch (error) {
        context.logger.error(`[直播监控] 记录 ${event.streamer} 超管切断失败`, error);
      }
    },
  };
}
