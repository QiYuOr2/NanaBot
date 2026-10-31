import { formatDuration } from "@nana/utils";
import { extractWords } from "./extract.ts";
import type {
  DanmuSessionInput,
  DanmuSessionSummary,
  SummarizeSessionOptions,
  TopChater,
  TopRepeated,
} from "./types.ts";

/** 把 Date | ISO 字符串统一成 ISO 字符串；非法输入直接抛出，避免静默产生 NaN 时长。 */
function toIso(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new Error(`无法解析${field}：${String(value)}`);
  }
  return date.toISOString();
}

/** Emoji / 图形符号（仅用于判断弹幕是否“只有表情”）。 */
const EMOJI_ONLY_PATTERN = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+$/u;

/** 是否为不含任何实际文字的弹幕（纯空白或纯 emoji）。 */
function isContentlessDanmu(content: string): boolean {
  return content.length === 0 || EMOJI_ONLY_PATTERN.test(content);
}

/**
 * 游客连接下 B 站把所有发送者的 uid 都置成 0，这种弹幕没有可区分的用户身份。
 * 统计时按「用户 + 昵称」分开计数，避免整场弹幕被算成同一个人。
 */
function speakerKey(message: DanmuSessionInput["messages"][number]): string {
  return message.userId === "0" ? `0\u0000${message.username}` : message.userId;
}

/**
 * 统计发言最多的人：按条数降序，条数相同时按首次发言的先后排序，
 * 再相同时按用户 ID 升序 —— 保证同一输入的结果完全确定。
 */
function pickTopChater(
  messages: readonly DanmuSessionInput["messages"][number][],
): TopChater | null {
  const stats = new Map<
    string,
    { userId: string; username: string; count: number; firstIndex: number }
  >();

  messages.forEach((message, index) => {
    const key = speakerKey(message);
    const current = stats.get(key);
    if (current) {
      current.count += 1;
      // 昵称以最近一次出现的为准，兼容中途改昵称。
      current.username = message.username;
      return;
    }
    stats.set(key, {
      userId: message.userId,
      username: message.username,
      count: 1,
      firstIndex: index,
    });
  });

  let best: TopChater | null = null;
  let bestStat: { count: number; firstIndex: number } | null = null;
  for (const stat of stats.values()) {
    const better =
      bestStat === null ||
      stat.count > bestStat.count ||
      (stat.count === bestStat.count &&
        (stat.firstIndex < bestStat.firstIndex ||
          (stat.firstIndex === bestStat.firstIndex && stat.userId < (best?.userId ?? ""))));
    if (better) {
      best = { userId: stat.userId, username: stat.username, count: stat.count };
      bestStat = { count: stat.count, firstIndex: stat.firstIndex };
    }
  }
  return best;
}

/**
 * 统计最高频的单条弹幕：按内容精确匹配，不区分发言者。
 * 频次相同时取最先出现的那条；纯 emoji / 空白弹幕不参与评选。
 */
function pickTopRepeated(
  messages: readonly DanmuSessionInput["messages"][number][],
): TopRepeated | null {
  const stats = new Map<string, { count: number; firstIndex: number }>();

  messages.forEach((message, index) => {
    if (isContentlessDanmu(message.content)) {
      return;
    }
    const content = message.content.trim();
    const current = stats.get(content);
    if (current) {
      current.count += 1;
      return;
    }
    stats.set(content, { count: 1, firstIndex: index });
  });

  let best: TopRepeated | null = null;
  let bestStat: { count: number; firstIndex: number } | null = null;
  for (const [content, stat] of stats) {
    const better =
      bestStat === null ||
      stat.count > bestStat.count ||
      (stat.count === bestStat.count && stat.firstIndex < bestStat.firstIndex);
    if (better) {
      best = { content, count: stat.count };
      bestStat = { count: stat.count, firstIndex: stat.firstIndex };
    }
  }
  return best;
}

/**
 * 汇总一场直播的弹幕统计。
 *
 * 只做纯计算：时长用 `@nana/utils` 的 `formatDuration` 格式化，Top 词用
 * {@link extractWords} 计算。空弹幕场次也会返回完整结构（`topWords` 为空数组，
 * `topChater` / `topRepeated` 为 `null`），由调用方决定对话术。
 *
 * @param input 场次信息与本场弹幕
 * @param options Top 词数量与分词选项
 */
export function summarizeSession(
  input: DanmuSessionInput,
  options: SummarizeSessionOptions = {},
): DanmuSessionSummary {
  const startedAt = toIso(input.startedAt, "开播时间");
  const endedAt = toIso(input.endedAt, "下播时间");
  const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  // 统计口径统一使用 trim 后的原文，避免 “好耶 ” 与 “好耶” 被算成两条。
  const messages = input.messages.map((message) => ({
    userId: message.userId,
    username: message.username,
    content: message.content.trim(),
  }));
  const participants = new Set<string>();
  for (const message of messages) {
    participants.add(speakerKey(message));
  }

  const topWordCount = Math.max(1, options.topWords ?? 10);
  const topWords = extractWords(
    messages.map((message) => message.content),
    { ...options.words, topN: topWordCount },
  );

  return {
    streamer: input.streamer,
    roomId: input.roomId,
    startedAt,
    endedAt,
    durationMs,
    durationText: formatDuration(durationMs),
    messageCount: messages.length,
    participantCount: participants.size,
    topWords,
    topChater: pickTopChater(messages),
    topRepeated: pickTopRepeated(messages),
  };
}
