import type {
  BilibiliDynamic,
  BilibiliDynamicType,
  RawDynamicItem,
  RawMajorEntry,
  RawModuleDynamic,
  RawRichTextNode,
  RawSummary,
} from "./types.ts";

const DEFAULT_DYNAMIC_URL_PREFIX = "https://t.bilibili.com/";

/** 判断一条动态是否为置顶：存在非空的 `module_tag.text`。 */
export function isPinnedDynamic(item: RawDynamicItem): boolean {
  const text = item.modules?.module_tag?.text;
  return typeof text === "string" && text.trim() !== "";
}

/** 宽容地把 number/string 解析成整数；无法解析返回 undefined（不抛错）。 */
function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** 去掉 `[...]` 表情标记。移植自 Boku `stripEmotes`。 */
export function stripEmotes(text: string): string {
  if (!text.includes("[")) return text;
  let result = "";
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("[", index);
    if (open < 0) {
      result += text.slice(index);
      break;
    }
    const close = text.indexOf("]", open + 1);
    if (close < 0) {
      // 未闭合：保留剩余原文。
      result += text.slice(index);
      break;
    }
    result += text.slice(index, open);
    index = close + 1;
  }
  return result;
}

/** 折叠空白为单空格。 */
function oneLine(text: string): string {
  return stripEmotes(text).split(/\s+/).filter(Boolean).join(" ");
}

/** 综合 summary.text 与 rich_text_nodes 提取正文，容错处理缺失与结构差异。 */
function readSummary(summary: RawSummary | undefined): string {
  if (!summary) return "";
  const nodes = summary.rich_text_nodes;
  if (Array.isArray(nodes) && nodes.length > 0) {
    const joined = nodes
      .map((node: RawRichTextNode) => (typeof node?.text === "string" ? node.text : ""))
      .join("");
    if (joined.trim()) return joined;
  }
  return typeof summary.text === "string" ? summary.text : "";
}

/** 解析某个 major entry 的展示正文（summary → title → desc 中第一个非空）。 */
function previewEntry(entry: RawMajorEntry | undefined): string {
  if (!entry) return "";
  const summary = oneLine(readSummary(entry.summary));
  if (summary) return summary;
  const title = typeof entry.title === "string" ? oneLine(entry.title) : "";
  if (title) return title;
  return typeof entry.desc === "string" ? oneLine(entry.desc) : "";
}

/** 把 `//host/...` 或 `/path` 规范化为绝对 URL；已是绝对 URL 保持不变。 */
function toAbsoluteUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://www.bilibili.com${trimmed}`;
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** 从图片列表（可能是字符串、对象或嵌套对象）中提取图片地址，容错并去重。 */
function extractImageUrls(source: unknown): string[] {
  const urls: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) urls.push(value.trim());
  };
  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object") return;
    for (const key of ["url", "src", "img_src", "cover"]) {
      push((node as Record<string, unknown>)[key]);
    }
  };
  visit(source);
  return [...new Set(urls)];
}

function classifyType(item: RawDynamicItem, dynamic: RawModuleDynamic): BilibiliDynamicType {
  const type = typeof item.type === "string" ? item.type : "";
  const major = dynamic.major ?? {};
  // 转发优先：不能把转发内容误解析成原创视频/图文。
  if (type.includes("FORWARD")) return "forward";
  if (type.includes("AV") || major.archive?.bvid) return "video";
  if (type.includes("ARTICLE") || major.article?.jump_url) return "article";
  if (type.includes("OPUS") || major.opus?.jump_url) return "opus";
  if (type.includes("DRAW") || major.draw?.jump_url) return "draw";
  // 纯文字动态（旧 WORD 类型）正文在 desc 中，按 opus 订阅与推送（订阅方要的就是文字动态）。
  if (type.includes("WORD")) return "opus";
  if (dynamic.desc) return "unknown";
  return "unknown";
}

/** 动态中的图片地址（含 opus / draw 的图片列表）。 */
function collectImages(dynamic: RawModuleDynamic): string[] {
  const major = dynamic.major ?? {};
  return extractImageUrls([major.opus?.pics, major.draw?.items, major.draw?.pics]);
}

/** 动态链接：优先 major entry 的 jump_url，其次按 bvid 生成，最后退回 t.bilibili。 */
function resolveUrl(item: RawDynamicItem, dynamic: RawModuleDynamic): string {
  const major = dynamic.major ?? {};
  for (const entry of [major.archive, major.opus, major.article, major.draw, major.live]) {
    const absolute = toAbsoluteUrl(entry?.jump_url);
    if (absolute) return absolute;
  }
  const id = item.id_str ?? (item.id !== undefined ? String(item.id) : "");
  if (major.archive?.bvid) return `https://www.bilibili.com/video/${major.archive.bvid}`;
  return `${DEFAULT_DYNAMIC_URL_PREFIX}${id}`;
}

/** 正文摘要的兜底顺序：desc → 各 major entry preview → 类型性文案。 */
function readText(type: BilibiliDynamicType, dynamic: RawModuleDynamic): string {
  const desc = typeof dynamic.desc?.text === "string" ? oneLine(dynamic.desc.text) : "";
  if (desc) return desc;
  const major = dynamic.major ?? {};
  for (const entry of [major.opus, major.archive, major.article, major.draw, major.live]) {
    const preview = previewEntry(entry);
    if (preview) return preview;
  }
  switch (type) {
    case "video":
      return "发布了新视频";
    case "article":
      return "发布了新专栏";
    case "opus":
    case "draw":
      return "发布了图片动态";
    default:
      return "";
  }
}

/**
 * 解析单条原始动态为标准化 {@link BilibiliDynamic}。
 *
 * 遇到缺少有效作者（mid/name/pub_ts/id 缺失或为 0）的畸形条目时返回 `undefined`，
 * 由 {@link parseDynamicFeed} 决定是整页失败还是跳过——这里选择跳过非关键畸形项，
 * 避免单条脏数据让整页无法使用。
 */
export function parseDynamicItem(
  item: RawDynamicItem,
  fallbackUid: number,
): BilibiliDynamic | undefined {
  const author = item.modules?.module_author;
  const dynamic = item.modules?.module_dynamic;
  if (!author || !dynamic) return undefined;

  const authorUid = toInt(author.mid);
  const authorName = typeof author.name === "string" ? author.name.trim() : "";
  const publishedSeconds = toInt(author.pub_ts);
  const id = item.id_str ?? (item.id !== undefined ? String(item.id) : "");
  if (!id || !authorName) return undefined;

  const type = classifyType(item, dynamic);
  const title =
    type === "video"
      ? (dynamic.major?.archive?.title ?? null)
      : type === "article"
        ? (dynamic.major?.article?.title ?? null)
        : (dynamic.major?.opus?.title ?? dynamic.major?.draw?.title ?? null);

  const coverUrl =
    toAbsoluteUrl(dynamic.major?.archive?.cover) ??
    toAbsoluteUrl(dynamic.major?.article?.cover) ??
    toAbsoluteUrl(dynamic.major?.opus?.cover) ??
    null;

  return {
    id,
    uid: authorUid ?? fallbackUid,
    authorName,
    authorFace: toAbsoluteUrl(author.face) ?? null,
    type,
    publishedAt:
      publishedSeconds && publishedSeconds > 0
        ? new Date(publishedSeconds * 1000).toISOString()
        : null,
    text: readText(type, dynamic),
    title: typeof title === "string" && title.trim() ? title.trim() : null,
    url: resolveUrl(item, dynamic),
    coverUrl,
    imageUrls: collectImages(dynamic),
  };
}

/** 解析一页动态 Feed：过滤置顶，跳过畸形条目，保留顺序。 */
export function parseDynamicFeed(items: readonly RawDynamicItem[], uid: number): BilibiliDynamic[] {
  const result: BilibiliDynamic[] = [];
  for (const item of items) {
    if (isPinnedDynamic(item)) continue;
    const parsed = parseDynamicItem(item, uid);
    if (parsed) result.push(parsed);
  }
  return result;
}
