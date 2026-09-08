import dayjs from "dayjs";
import duration from "dayjs/plugin/duration.js";

dayjs.extend(duration);

export function dateFormat(timestamp: number): string {
  return dayjs(timestamp).format("YYYY/MM/DD HH:mm:ss");
}

/** 把毫秒时长格式化为中文可读形式，如 “1 小时 1 分钟”。 */
export function formatDuration(ms: number): string {
  if (ms < 0) {
    return "0 秒";
  }

  const d = dayjs.duration(ms);
  const hours = Math.floor(d.asHours());
  const minutes = d.minutes();
  const seconds = d.seconds();
  const parts: string[] = [];

  if (hours) {
    parts.push(`${hours} 小时`);
  }
  if (minutes) {
    parts.push(`${minutes} 分钟`);
  }
  if (seconds || parts.length === 0) {
    parts.push(`${seconds} 秒`);
  }

  return parts.join(" ");
}
