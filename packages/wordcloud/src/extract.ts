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

/**
 * 把一批弹幕清洗成词频列表。
 *
 * - 分词用精确模式，并叠了网络新词 / 直播用语用户词典。搜索模式会把整词再拆成碎片，词云会显得很碎。
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

    for (const raw of getJieba().cut(prepared, true)) {
      const normalized = normalizeWord(raw);
      // 现代词表里的整词保留原样；其余词去掉句尾语气，让「好看了」并进「好看」。
      const word = MODERN_WORD_SET.has(normalized)
        ? normalized
        : normalized.replace(TAIL_PARTICLES, "");
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
