/** 送进模型的弹幕摘录上限，避免一场几万条弹幕撑爆请求。 */
const MAX_RECENT_LINES = 160;
const MAX_REPEATED_LINES = 12;
const MAX_EXCERPT_CHARS = 7000;
const REPEAT_THRESHOLD = 3;

export interface SummaryMessage {
  content: string;
}

export interface DanmuExcerpt {
  /** 可送给模型的摘录。没有可用弹幕时为空字符串。 */
  text: string;
  /** 去掉空白后还剩下的弹幕条数。 */
  usableCount: number;
}

/** 从一场弹幕里抽出高频句和靠近下播的发言。 */
export function buildDanmuExcerpt(messages: readonly SummaryMessage[]): DanmuExcerpt {
  const usable = messages
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);
  if (usable.length === 0) {
    return { text: "", usableCount: 0 };
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

  let recent = usable.slice(-MAX_RECENT_LINES).join("\n");
  if (recent.length > MAX_EXCERPT_CHARS) {
    recent = recent.slice(recent.length - MAX_EXCERPT_CHARS);
    const newline = recent.indexOf("\n");
    if (newline >= 0 && newline < 200) {
      recent = recent.slice(newline + 1);
    }
  }

  const parts = [
    repeated.length > 0 ? `高频弹幕：\n${repeated.join("\n")}` : "",
    `按时间摘录：\n${recent}`,
  ].filter((part) => part.length > 0);

  return { text: parts.join("\n\n"), usableCount: usable.length };
}
