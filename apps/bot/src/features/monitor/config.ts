import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

export function loadMonitorConfig(filePath = resolve(process.cwd(), "monitor.config.json")): MonitorConfig {
  const raw = readFileSync(filePath, "utf8");
  const config = JSON.parse(raw) as Partial<MonitorConfig>;

  if (!Array.isArray(config.streamers)) {
    throw new Error("monitor.config.json 必须包含 streamers 数组。");
  }

  return {
    streamers: config.streamers.map(normalizeStreamerConfig),
  };
}

function normalizeStreamerConfig(streamer: unknown): MonitorStreamerConfig {
  if (Array.isArray(streamer)) {
    const [roomId, streamerName] = streamer;

    if (!Number.isInteger(roomId) || typeof streamerName !== "string" || streamerName.length === 0) {
      throw new Error("旧格式 streamers 项必须是 [roomId, streamerName]，且值必须有效。");
    }

    return {
      roomId,
      streamer: streamerName,
      notifyGroups: [],
      messages: createDefaultMessages(streamerName),
    };
  }

  if (!streamer || typeof streamer !== "object") {
    throw new Error("streamers 中的每一项都必须是对象。");
  }

  const roomId: number = Reflect.get(streamer, "roomId");
  const streamerName: string = Reflect.get(streamer, "streamer");
  const notifyGroups: number[] = Reflect.get(streamer, "notifyGroups");
  const messages: string[] = Reflect.get(streamer, "messages");

  if (!Number.isInteger(roomId) || typeof streamerName !== "string" || streamerName.length === 0) {
    throw new Error("streamers 中的每一项都必须包含有效的 roomId 和非空的 streamer。");
  }

  if (!Array.isArray(notifyGroups) || notifyGroups.some((groupId) => !Number.isInteger(groupId))) {
    throw new Error("streamers 中的 notifyGroups 必须是数字数组。");
  }

  return {
    roomId,
    streamer: streamerName,
    notifyGroups,
    messages: normalizeMessageConfig(streamerName, messages),
  };
}

function normalizeMessageConfig(streamer: string, messages: unknown): MonitorMessageConfig {
  const defaults = createDefaultMessages(streamer);

  if (messages == null) {
    return defaults;
  }

  if (!messages || typeof messages !== "object") {
    throw new Error("streamers 中的 messages 必须是对象。");
  }

  const liveStart = Reflect.get(messages, "liveStart");
  const replayStart = Reflect.get(messages, "replayStart");
  const liveEnd = Reflect.get(messages, "liveEnd");

  if (liveStart != null && typeof liveStart !== "string") {
    throw new Error("messages.liveStart 必须是字符串。");
  }

  if (replayStart != null && typeof replayStart !== "string") {
    throw new Error("messages.replayStart 必须是字符串。");
  }

  if (liveEnd != null && typeof liveEnd !== "string") {
    throw new Error("messages.liveEnd 必须是字符串。");
  }

  return {
    liveStart: liveStart ?? defaults.liveStart,
    liveEnd: liveEnd ?? defaults.liveEnd,
  };
}

function createDefaultMessages(streamer: string): MonitorMessageConfig {
  return {
    liveStart: `${streamer} 开播了`,
    liveEnd: `${streamer} 下播了`,
  };
}
