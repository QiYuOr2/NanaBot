import type { BilibiliDynamic, BilibiliDynamicType } from "@nana/bilibili-api";
import type { PushLogPurpose } from "@nana/constants";

/** 正文摘要最大长度（按 Unicode 码点截断，避免拆断 emoji / 代理对）。 */
export const MAX_SUMMARY_CHARS = 300;
/** 图文动态最多附带的图片数。 */
export const MAX_IMAGES = 3;

/**
 * 按 Unicode 码点安全截断字符串。
 *
 * 使用 `Array.from` 按码点切分，避免把代理对（如 emoji）截成半个字符产生乱码。
 */
export function truncateByCodePoint(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("")}…`;
}

/** 把动态类型映射到推送日志 purpose。article 独立，其余图文类归入 opus。 */
export function purposeForType(type: BilibiliDynamicType): PushLogPurpose {
  switch (type) {
    case "video":
      return "dynamic.video";
    case "article":
      return "dynamic.article";
    case "opus":
    case "draw":
    default:
      return "dynamic.opus";
  }
}

export interface FormattedDynamic {
  /** 推送日志用的 purpose。 */
  purpose: PushLogPurpose;
  /** 推送日志 content 摘要（一行）。 */
  summary: string;
  /** 推送主体（UP 主名）。 */
  subject: string;
  /** 主文本（标题/正文，不含图片）。 */
  text: string;
  /** 封面图地址（视频/专栏可用）。 */
  coverUrl: string | null;
  /** 图文图片地址（已截断到 MAX_IMAGES）。 */
  imageUrls: string[];
  /** 原动态链接。 */
  url: string;
}

/**
 * 把标准化动态格式化为推送内容。
 *
 * 文本布局：
 * - 视频：`{UP} 发布了新视频\n{标题}\n{发布时间}\n{链接}`
 * - 图文：`{UP} 发布了新动态\n{正文摘要}\n{链接}`
 * - 专栏：`{UP} 发布了新专栏\n{标题}\n{摘要}\n{链接}`
 */
export function formatDynamic(dynamic: BilibiliDynamic): FormattedDynamic {
  const purpose = purposeForType(dynamic.type);
  const subject = dynamic.authorName || String(dynamic.uid);
  const lines: string[] = [];

  switch (dynamic.type) {
    case "video": {
      lines.push(`${subject} 发布了新视频`);
      if (dynamic.title) lines.push(dynamic.title);
      const time = formatPublishedAt(dynamic.publishedAt);
      if (time) lines.push(time);
      break;
    }
    case "article": {
      lines.push(`${subject} 发布了新专栏`);
      if (dynamic.title) lines.push(dynamic.title);
      if (dynamic.text) lines.push(truncateByCodePoint(dynamic.text, MAX_SUMMARY_CHARS));
      break;
    }
    case "opus":
    case "draw":
    default: {
      lines.push(`${subject} 发布了新动态`);
      if (dynamic.text) lines.push(truncateByCodePoint(dynamic.text, MAX_SUMMARY_CHARS));
      break;
    }
  }
  lines.push(dynamic.url);
  const text = lines.join("\n");

  const imageUrls =
    dynamic.type === "video" || dynamic.type === "article"
      ? []
      : dynamic.imageUrls.slice(0, MAX_IMAGES);

  return {
    purpose,
    summary: `${subject}：${dynamic.title ?? truncateByCodePoint(dynamic.text, 80)}`,
    subject,
    text,
    coverUrl: dynamic.coverUrl,
    imageUrls,
    url: dynamic.url,
  };
}

/** 把 ISO 发布时间格式化为本地可读字符串；无法解析返回 null。 */
function formatPublishedAt(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
