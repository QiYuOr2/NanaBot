/** 送进模型的弹幕摘录上限，避免一场几万条弹幕撑爆请求。 */
const MAX_SAMPLE_LINES = 160;
const MAX_REPEATED_LINES = 12;
const MAX_FULL_MESSAGES = 5000;
const MAX_FULL_EXCERPT_CHARS = 64_000;
const MAX_SAMPLE_EXCERPT_CHARS = 7000;
const REPEAT_THRESHOLD = 3;

export interface SummaryMessage {
  content: string;
}

export interface DanmuExcerpt {
  /** 可送给模型的摘录。没有可用弹幕时为空字符串。 */
  text: string;
  /** 去掉空白后还剩下的弹幕条数。 */
  usableCount: number;
  /** `full` 表示整场弹幕都在摘录里；`sampled` 表示因超量只做了等距抽样。 */
  mode: "full" | "sampled";
}

/**
 * 从一场弹幕里抽出高频句和覆盖整场的发言样本。
 *
 * 长场次不能只取最后一段：观众在开播和中段聊的内容同样属于本场。
 * 这里按时间顺序等距抽样，首尾都会保留；字符超限时减少抽样条数而不是从尾部截断。
 */
export function buildDanmuExcerpt(messages: readonly SummaryMessage[]): DanmuExcerpt {
  const usable = messages
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);
  if (usable.length === 0) {
    return { text: "", usableCount: 0, mode: "full" };
  }

  const counts = new Map<string, number>();
  for (const line of usable) {
    const key = line.slice(0, 40);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const repeated = [...counts.entries()]
    .filter(([, count]) => count >= REPEAT_THRESHOLD)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh"))
    .slice(0, MAX_REPEATED_LINES)
    .map(([line, count]) => `${line} ×${count}`);

  const full = usable.join("\n");
  const useFull = usable.length <= MAX_FULL_MESSAGES && full.length <= MAX_FULL_EXCERPT_CHARS;
  const lines = useFull ? usable : sampleEvenly(usable, MAX_SAMPLE_LINES, MAX_SAMPLE_EXCERPT_CHARS);

  const parts = [
    repeated.length > 0 ? `高频弹幕：\n${repeated.join("\n")}` : "",
    useFull
      ? `完整弹幕（按时间顺序）：\n${lines.join("\n")}`
      : `全程抽样（覆盖开播到下播，相邻行不一定连续）：\n${lines.join("\n")}`,
  ].filter((part) => part.length > 0);

  return {
    text: parts.join("\n\n"),
    usableCount: usable.length,
    mode: useFull ? "full" : "sampled",
  };
}

/** 按数组顺序等距取样，并保证首尾都在样本里。 */
function sampleEvenly(
  lines: readonly string[],
  limit: number,
  maxChars: number,
): readonly string[] {
  let count = Math.min(lines.length, limit);
  while (count > 0) {
    if (count === 1) {
      return [lines[0]!];
    }
    const indexes = new Set<number>();
    for (let slot = 0; slot < count; slot += 1) {
      indexes.add(Math.round((slot * (lines.length - 1)) / (count - 1)));
    }
    const sample = [...indexes].sort((left, right) => left - right).map((index) => lines[index]);
    const length = sample.join("\n").length;
    if (length <= maxChars) {
      return sample;
    }
    count = Math.max(1, Math.floor((count * maxChars) / length));
  }

  return [];
}
