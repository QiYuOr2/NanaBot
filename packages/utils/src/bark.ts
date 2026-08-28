import { BARK_BASE_URL, BARK_ICON_URL, ENV_KEYS } from "@nana/constants";

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
    BARK_BASE_URL +
    `${process.env[ENV_KEYS.BARK_KEY]}/` +
    title +
    content +
    `?icon=${BARK_ICON_URL}` +
    group
  );
}
