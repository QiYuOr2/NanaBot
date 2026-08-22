import dayjs from "dayjs";

const BASE_BARK_URL = "https://api.day.app/";

export interface BarkConfig {
  title: string;
  content: string;
  group: string;
}

export function barkURL(config: BarkConfig): string {
  const title = config.title ? `${encodeURIComponent(config.title)}/` : "";
  const content = config.content ? `${encodeURIComponent(config.content)}/` : "";
  const group = config.group ? `&group=${encodeURIComponent(config.group)}` : "";

  return (
    BASE_BARK_URL +
    `${process.env.BARK_KEY}/` +
    title +
    content +
    "?icon=https://unavatar.io/github/qiyuor2" +
    group
  );
}

export function dateFormat(timestamp: number): string {
  return dayjs(timestamp).format("YYYY/MM/DD HH:mm:ss");
}

export function readOptionalNumberEnv(key: string): number | undefined {
  const value = process.env[key];

  if (!value) {
    return undefined;
  }

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    throw new Error(`${key} 必须是有效数字。`);
  }

  return numberValue;
}
