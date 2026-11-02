import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";
import { encodeModernDict, MODERN_WORD_SET } from "./dict.ts";
import { DEFAULT_NOISE_WORDS, DEFAULT_STOP_WORDS } from "./words.ts";
import type { ExtractWordsOptions, WordCount } from "./types.ts";

/**
 * 全局唯一的 jieba 实例。
 *
 * `@node-rs/jieba` v2 不再导出默认单例，需要自己用内置词典构建，再叠上现代用户词典。
 * 词典加载有一定开销，因此按模块级懒加载，一次构建后整进程复用。
 */
let jieba: Jieba | undefined;

function getJieba(): Jieba {
  if (!jieba) {
    const instance = Jieba.withDict(dict);
    instance.loadDict(encodeModernDict());
    jieba = instance;
  }
  return jieba;
}

/**
 * B 站表情包占位，如 `[dog]`、`[笑哭]`、`【妙】`。
 * 先从原文去掉，避免被切成 `dog` / `笑` / `哭` 这类词。
 */
const EMOTE_TOKEN = /[[【][^[\]【】\s]{1,16}[\]】]/gu;

/** 纯标点 / 符号（Unicode P 类与 S 类，含常见全角标点）。 */
const PUNCTUATION_PATTERN = /^[\p{P}\p{S}\s]+$/u;

/** 纯数字（含小数点、千分位等常见写法）。 */
const NUMBER_PATTERN = /^[\d\s.,:+-]+$/;

/** 纯 emoji / 图形符号。 */
const EMOJI_PATTERN = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]+$/u;

/** 单个 ASCII 字母或数字，属于英文分词碎片。 */
const ISOLATED_ASCII_ALNUM = /^[a-z0-9]$/;

/** 单个中文字符（CJK 统一表意文字）。 */
const ISOLATED_HAN = /^\p{Script=Han}$/u;

/** 需要从词中剥离的尾部语气词。 */
const TAIL_PARTICLES = /[了啊呀吧呢嘛哦噢喔诶欸额]+$/u;

/** 按 Unicode 码点计算字符串长度（避免 emoji 被算成 2）。 */
function codePointLength(text: string): number {
  let length = 0;
  // 逐码点迭代，代理对只算 1 个字符。
  for (const _ of text) {
    length += 1;
  }
  return length;
}

/** 归一化：全角转半角、合并空白、转小写。 */
function normalizeWord(word: string): string {
  return word.normalize("NFKC").replace(/\s+/gu, "").trim().toLowerCase();
}

/** 判断一个词是否应当在分词阶段被丢弃。 */
function isFilteredWord(word: string, stopWords: Set<string>, noiseWords: Set<string>): boolean {
  if (word.length === 0) {
    return true;
  }
  if (word.includes("[") || word.includes("]") || word.includes("【") || word.includes("】")) {
    return true;
  }
  if (PUNCTUATION_PATTERN.test(word) || NUMBER_PATTERN.test(word) || EMOJI_PATTERN.test(word)) {
    return true;
  }
  if (stopWords.has(word) || noiseWords.has(word)) {
    return true;
  }
  // 单字：中文单字和字母/数字碎片一律过滤（`minLength` 只能调大，不能调到 1）。
  if (ISOLATED_HAN.test(word) || ISOLATED_ASCII_ALNUM.test(word)) {
    return true;
  }
  return false;
}

/** 「利好 / 利空」本身没有所指，必须接上后面的对象；接不上就丢掉。 */
const BOUND_PREFIX = /^(?:突发|真|最|最大)?(?:利好|利空)$/u;

/**
 * 「之刃」「之智」这类碎片必须接上前面的词。
 * 「之前 / 之后」是时间虚词，不能粘进去。
 */
const BOUND_SUFFIX = /^之\p{Script=Han}{1,2}$/u;

const ZHI_FUNCTION = new Set([
  "之前",
  "之后",
  "之间",
  "之下",
  "之外",
  "之一",
  "之内",
  "之中",
  "之余",
  "之多",
  "之际",
]);

/** 出现在利好后面也不构成话题的趋向说法。 */
const NON_TOPIC_FOLLOWERS = new Set(["来了", "来啦", "去了", "好了", "行了", "完了", "懂了"]);

const SUFFIX_HEAD = /^[\p{Script=Han}a-z0-9]{1,8}$/u;

function isDiscardedToken(token: string): boolean {
  return (
    token.length === 0 ||
    PUNCTUATION_PATTERN.test(token) ||
    NUMBER_PATTERN.test(token) ||
    EMOJI_PATTERN.test(token)
  );
}

function isBoundSuffix(token: string): boolean {
  return BOUND_SUFFIX.test(token) && !ZHI_FUNCTION.has(token);
}

/** 去掉句尾语气；「股神来了」这种粘连再剥掉词表里已有词后面的「来 / 去」。 */
function settleToken(token: string): string {
  const normalized = normalizeWord(token);
  if (!normalized || MODERN_WORD_SET.has(normalized)) {
    return normalized;
  }
  const withoutTail = normalized.replace(TAIL_PARTICLES, "");
  const stem = withoutTail.replace(/[来去]+$/u, "");
  if (stem !== withoutTail && codePointLength(stem) >= 2 && MODERN_WORD_SET.has(stem)) {
    return stem;
  }
  return withoutTail;
}

function isSuffixHead(token: string, stopWords: ReadonlySet<string>): boolean {
  return SUFFIX_HEAD.test(token) && !stopWords.has(token) && !isDiscardedToken(token);
}

function isPrefixObject(
  token: string,
  stopWords: ReadonlySet<string>,
  noiseWords: ReadonlySet<string>,
): boolean {
  if (BOUND_PREFIX.test(token) || isBoundSuffix(token)) {
    return false;
  }
  if (stopWords.has(token) || noiseWords.has(token) || NON_TOPIC_FOLLOWERS.has(token)) {
    return false;
  }
  return !isDiscardedToken(token) && codePointLength(token) >= 2;
}

/**
 * 把切开的碎片粘回整词。
 *
 * - 「影 / 之刃」「巅峰 / 之智」接成「影之刃」「巅峰之智」；粘不上的「之刃」直接丢掉。
 * - 「利好 / 机器人」「利好 / 商业航天」接成一个词；后面没有对象的「利好」丢掉。
 */
function composeTokens(
  rawTokens: readonly string[],
  stopWords: ReadonlySet<string>,
  noiseWords: ReadonlySet<string>,
): string[] {
  const suffixed: string[] = [];
  for (const raw of rawTokens) {
    const token = settleToken(raw);
    if (!token) {
      continue;
    }
    const previous = suffixed.at(-1);
    if (previous && isBoundSuffix(token) && isSuffixHead(previous, stopWords)) {
      suffixed[suffixed.length - 1] = previous + token;
      continue;
    }
    if (isBoundSuffix(token)) {
      continue;
    }
    suffixed.push(token);
  }

  const composed: string[] = [];
  for (let index = 0; index < suffixed.length; index += 1) {
    const token = suffixed[index];
    if (!token || !BOUND_PREFIX.test(token)) {
      if (token) {
        composed.push(token);
      }
      continue;
    }

    const next = suffixed[index + 1];
    if (next && isPrefixObject(next, stopWords, noiseWords)) {
      composed.push(token + next);
      index += 1;
    }
  }
  return composed;
}

/**
 * 把一批弹幕清洗成词频列表。
 *
 * - 分词用精确模式，并叠了网络新词 / 直播用语用户词典。搜索模式会把整词再拆成碎片，词云会显得很碎。
 * - 「利好 + 对象」「前文 + 之刃」这类离开彼此就没有所指的词会粘成一个词；粘不上的碎片不进词云。
 * - 过滤：`[dog]` 这类表情包、默认停用词 + 噪音词、长度小于 `minLength`（默认 2）、纯数字、纯标点/符号、纯 emoji。
 * - 词经过 NFKC 归一化并统一小写，`哈哈` 与 `哈哈ｗ` 之类不会被拆成两个词。
 * - 结果先按 `count` 降序、再按 `word` 升序排列，保证同一输入的结果完全确定。
 *
 * @param contents 弹幕原文列表。
 * @param options 分词选项，见 {@link ExtractWordsOptions}。
 * @returns 词频数组，`topN` 不传时返回全部词。
 */
export function extractWords(
  contents: readonly string[],
  options: ExtractWordsOptions = {},
): WordCount[] {
  const stopWords = new Set(
    (options.stopWords ?? DEFAULT_STOP_WORDS).map((word) => normalizeWord(word)),
  );
  const noiseWords = new Set(
    (options.noiseWords ?? DEFAULT_NOISE_WORDS).map((word) => normalizeWord(word)),
  );
  for (const word of options.extraStopWords ?? []) {
    const normalized = normalizeWord(word);
    if (normalized) {
      stopWords.add(normalized);
    }
  }
  for (const word of options.extraNoiseWords ?? []) {
    const normalized = normalizeWord(word);
    if (normalized) {
      noiseWords.add(normalized);
    }
  }

  const minLength = Math.max(2, options.minLength ?? 2);
  const counts = new Map<string, number>();

  for (const content of contents) {
    if (!content) {
      continue;
    }

    // 同一行里同一个词只计一次，避免一句口播把同一个词刷高。
    const seenInLine = new Set<string>();
    EMOTE_TOKEN.lastIndex = 0;
    const prepared = content.normalize("NFKC").replace(EMOTE_TOKEN, " ");

    for (const word of composeTokens(getJieba().cut(prepared, true), stopWords, noiseWords)) {
      if (isFilteredWord(word, stopWords, noiseWords)) {
        continue;
      }
      if (codePointLength(word) < minLength) {
        continue;
      }
      if (seenInLine.has(word)) {
        continue;
      }
      seenInLine.add(word);
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  const sorted = [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      return left.word < right.word ? -1 : left.word > right.word ? 1 : 0;
    });

  const topN = options.topN ?? 0;
  return topN > 0 ? sorted.slice(0, topN) : sorted;
}
