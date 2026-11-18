/**
 * Bilibili 动态 API 的类型定义。
 *
 * 原始响应类型按 B 站 Web 动态接口的实际结构建模，对未知字段保持开放（使用可选字段 +
 * `unknown` 兜底），避免接口微调导致整页解析失败；对外只暴露稳定的 {@link BilibiliDynamic}。
 */

/** 标准化后的动态类型。`unknown` 用于无法识别的新类型，避免整页解析失败。 */
export type BilibiliDynamicType = "video" | "opus" | "draw" | "article" | "forward" | "unknown";

/** API 层向 Bot 输出的稳定领域类型，屏蔽 B 站嵌套响应。 */
export interface BilibiliDynamic {
  /** 动态 ID，始终按字符串保存（B 站可能超出 JS 安全整数范围）。 */
  id: string;
  /** 发布者 UID。 */
  uid: number;
  /** 发布者昵称。 */
  authorName: string;
  /** 发布者头像地址；缺失时为 null。 */
  authorFace: string | null;
  /** 标准化动态类型。 */
  type: BilibiliDynamicType;
  /** 发布时间（ISO 字符串）；无法解析时为 null。 */
  publishedAt: string | null;
  /** 正文纯文本摘要（已去除表情标记并折叠空白）。 */
  text: string;
  /** 视频 / 专栏标题；无标题时为 null。 */
  title: string | null;
  /** 动态原链接（已是可直接访问的绝对地址）。 */
  url: string;
  /** 封面图地址；缺失时为 null。 */
  coverUrl: string | null;
  /** 图文图片地址列表；缺失时为空数组。 */
  imageUrls: string[];
}

/** Feed 请求的可选参数。 */
export interface DynamicFeedOptions {
  /** 覆盖 API 域名，默认 `https://api.bilibili.com`。 */
  baseUrl?: string;
  /** 覆盖 Web 站根域名（用于匿名 Cookie 初始化），默认 `https://www.bilibili.com`。 */
  webBaseUrl?: string;
  /** 覆盖 fetch 实现，便于测试注入。 */
  fetch?: typeof globalThis.fetch;
  /** 单请求超时（毫秒），默认 10000。 */
  timeoutMs?: number;
  /** 空列表重试次数上限，默认 3。 */
  emptyRetries?: number;
  /** 空列表重试间隔（毫秒），默认 400。 */
  emptyRetryDelayMs?: number;
  /** 注入时钟（毫秒），便于测试 WBI 签名与缓存过期。 */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// B 站原始响应结构（开放、容错）
// ---------------------------------------------------------------------------

/** 通用的富文本节点（新版 opus 的 rich_text_nodes）。 */
export interface RawRichTextNode {
  type?: string;
  text?: string;
}

export interface RawSummary {
  text?: string;
  rich_text_nodes?: RawRichTextNode[];
}

export interface RawMajorEntry {
  bvid?: string;
  title?: string;
  jump_url?: string;
  desc?: string;
  summary?: RawSummary;
  cover?: string;
  /** 图片动态的图片列表（形态可能多样，解析时容错）。 */
  items?: unknown;
  /** 新版 opus 的图片列表。 */
  pics?: unknown;
}

export interface RawMajor {
  archive?: RawMajorEntry;
  opus?: RawMajorEntry;
  article?: RawMajorEntry;
  draw?: RawMajorEntry;
  live?: RawMajorEntry;
  common?: RawMajorEntry;
  pgc?: RawMajorEntry;
}

export interface RawModuleDynamic {
  desc?: { text?: string } | null;
  major?: RawMajor | null;
}

export interface RawModuleAuthor {
  mid?: number | string;
  name?: string;
  face?: string;
  pub_ts?: number | string;
}

export interface RawModuleTag {
  text?: string;
}

export interface RawDynamicModules {
  module_author?: RawModuleAuthor;
  module_dynamic?: RawModuleDynamic;
  module_tag?: RawModuleTag | null;
}

export interface RawDynamicItem {
  id_str?: string;
  id?: number | string;
  type?: string;
  modules?: RawDynamicModules;
}

export interface RawDynamicFeedData {
  has_more?: boolean;
  offset?: string;
  items?: RawDynamicItem[];
}

export interface RawDynamicFeedResponse {
  code?: number;
  message?: string;
  msg?: string;
  data?: RawDynamicFeedData | null;
}

export interface RawNavResponse {
  code?: number;
  message?: string;
  data?: {
    wbi_img?: {
      img_url?: string;
      sub_url?: string;
    } | null;
  } | null;
}
