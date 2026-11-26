import { readConfig } from "@nana/config";
import {
  listDanmuSessions,
  readDanmuMessages,
  readDanmuSession,
  readDanmuSessionCutOffs,
  readLiveSummary,
  type DanmuSession,
  type DanmuSessionWithStats,
  type StoredLiveSummary,
} from "@nana/storage";
import { extractWords, summarizeSession, type DanmuMessageLike } from "@nana/wordcloud";
import { formatDuration } from "@nana/utils";
import { z } from "zod";
import {
  DANMU_DETAIL_MESSAGE_LIMIT,
  DANMU_DETAIL_TOP_WORDS,
  DANMU_SESSION_LIST_LIMIT,
  DANMU_SESSION_TOP_WORDS,
  DANMU_SESSION_TOP_WORDS_SESSIONS,
  DANMU_WORDCLOUD_MAX_WORDS,
  toDanmuSessionStats,
  toDanmuSessionSummary,
  type DanmuLiveSummaryDto,
  toDanmuWordCounts,
  type DanmuMessageDto,
  type DanmuSessionDetailResponse,
  type DanmuSessionSummaryDto,
  type DanmuWordCountDto,
} from "../../shared/danmu.ts";

/**
 * `nana.config.yaml` 的全局 `wordcloud` 段（与 `apps/bot/src/danmu/config.ts` 同构）。
 *
 * 面板只读取分词与渲染字段，和机器人推送使用同一套停用词、噪音词与字体。
 * 是否录制、推到哪些群写在对应主播上，面板不读。
 */
const WordCloudConfigFieldsSchema = z.object({
  topN: z.number().int().positive().default(DANMU_WORDCLOUD_MAX_WORDS),
  minWordLength: z.number().int().min(1).default(2),
  stopWords: z.array(z.string()).default([]),
  noiseWords: z.array(z.string()).default([]),
  fontPath: z.string().optional(),
});

const WordCloudConfigSchema = z.object({
  wordcloud: WordCloudConfigFieldsSchema.optional(),
});

export interface DanmuWordCloudOptions {
  /** 词云最多绘制的词数。 */
  topN: number;
  /** 分词选项：主播名与额外噪音词用 `extraNoiseWords` 叠加，不覆盖默认词表。 */
  words: {
    extraStopWords: string[];
    extraNoiseWords: string[];
    minLength: number;
  };
  /** 中文字体文件路径，缺省时由渲染层挑选系统字体。 */
  fontPath?: string;
}

/**
 * 读取面板使用的词云配置。
 *
 * 配置文件缺失或该段非法时回退默认值：`nana.config.yaml` 是运行时数据，不应因为
 * 一处配置写错导致整个面板的弹幕页 500。错误只记录到服务端日志。
 */
export function loadDanmuWordCloudOptions(): DanmuWordCloudOptions {
  const defaults: DanmuWordCloudOptions = {
    topN: DANMU_WORDCLOUD_MAX_WORDS,
    words: { extraStopWords: [], extraNoiseWords: [], minLength: 2 },
  };

  try {
    const { wordcloud } = WordCloudConfigSchema.parse(readConfig());
    if (!wordcloud) {
      return defaults;
    }
    return {
      topN: wordcloud.topN,
      words: {
        extraStopWords: wordcloud.stopWords,
        extraNoiseWords: wordcloud.noiseWords,
        minLength: wordcloud.minWordLength,
      },
      fontPath: wordcloud.fontPath || undefined,
    };
  } catch (error) {
    console.warn("[site] 读取 nana.config.yaml 的 wordcloud 段失败，使用默认词云配置", error);
    return defaults;
  }
}

/** 主播名会被当作噪音词过滤，避免「饭总」这类固定称谓霸榜。 */
function toWordOptions(options: DanmuWordCloudOptions, streamer: string) {
  return {
    extraStopWords: options.words.extraStopWords,
    extraNoiseWords: [streamer, ...options.words.extraNoiseWords],
    minLength: options.words.minLength,
  };
}

/** 场次有效时长：进行中的场次按「截至当前」计算，结束早于开始按 0 处理。 */
function sessionDuration(session: DanmuSession): { ms: number; text: string } {
  const endedAt = session.endedAt ? Date.parse(session.endedAt) : Date.now();
  const startedAt = Date.parse(session.startedAt);
  const ms =
    Number.isFinite(endedAt) && Number.isFinite(startedAt) ? Math.max(0, endedAt - startedAt) : 0;
  return { ms, text: formatDuration(ms) };
}

/** 读取某场次的全部弹幕并转成 `@nana/wordcloud` 需要的最小结构。 */
function readSessionMessages(sessionId: number): DanmuMessageLike[] {
  return readDanmuMessages(sessionId).map((message) => ({
    userId: message.userId,
    username: message.username,
    content: message.content,
  }));
}

/** 计算一场直播的词频；清洗规则与 bot 推送词云时完全一致。 */
function extractSessionWords(
  messages: readonly DanmuMessageLike[],
  streamer: string,
  options: DanmuWordCloudOptions,
  topN: number,
): DanmuWordCountDto[] {
  return toDanmuWordCounts(
    extractWords(
      messages.map((message) => message.content),
      { ...toWordOptions(options, streamer), topN },
    ),
  );
}

/** 只有确实记了弹幕的场次才值得读库算词频，空场次直接返回空数组。 */
function topWordsFor(session: DanmuSessionWithStats, options: DanmuWordCloudOptions) {
  if (session.msgCount <= 0) {
    return [];
  }
  return extractSessionWords(
    readSessionMessages(session.id),
    session.streamer,
    options,
    DANMU_SESSION_TOP_WORDS,
  );
}

/**
 * 场次列表。
 *
 * 性能约束：只有最近 {@link DANMU_SESSION_TOP_WORDS_SESSIONS} 场会读取全量弹幕计算
 * Top 词，更早的场次 `topWords` 直接返回空数组，避免一次请求把整张弹幕表翻一遍。
 */
export function buildDanmuSessionList(limit = DANMU_SESSION_LIST_LIMIT): DanmuSessionSummaryDto[] {
  const sessions = listDanmuSessions({}, limit);
  const options = loadDanmuWordCloudOptions();

  return sessions.map((session, index) => {
    const topWords = index < DANMU_SESSION_TOP_WORDS_SESSIONS ? topWordsFor(session, options) : [];
    return toDanmuSessionSummary(session, sessionDuration(session), topWords);
  });
}

/**
 * 单场详情：统计 + Top 词 + 最近弹幕。
 *
 * 场次不存在时返回 undefined（由路由抛 404）。统计口径由 `summarizeSession` 统一，
 * 保证面板数字与机器人推送给管理员群的文案一致。
 */
export function buildDanmuSessionDetail(id: number): DanmuSessionDetailResponse | undefined {
  const session = readDanmuSession(id);
  if (!session) {
    return undefined;
  }

  const options = loadDanmuWordCloudOptions();
  const messages = readSessionMessages(session.id);
  const duration = sessionDuration(session);
  const summary = summarizeSession(
    {
      streamer: session.streamer,
      roomId: Number(session.roomId),
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? new Date().toISOString(),
      messages,
    },
    { topWords: DANMU_DETAIL_TOP_WORDS, words: toWordOptions(options, session.streamer) },
  );

  // 最近弹幕倒序展示：存储层按时间正序返回，这里只取末尾并反转。
  const recent = readDanmuMessages(session.id)
    .slice(-DANMU_DETAIL_MESSAGE_LIMIT)
    .reverse()
    .map<DanmuMessageDto>((message) => ({
      id: message.id,
      sentAt: message.sentAt,
      userId: message.userId,
      username: message.username,
      content: message.content,
    }));

  const cutOffs = readDanmuSessionCutOffs(session.id).map((item) => ({
    id: item.id,
    cutOffAt: item.cutOffAt,
    reason: item.reason,
  }));

  return {
    session: toDanmuSessionSummary(
      { ...session, participantCount: summary.participantCount, cutOffCount: cutOffs.length },
      duration,
      toDanmuWordCounts(summary.topWords),
    ),
    stats: toDanmuSessionStats(summary),
    cutOffs,
    topWords: toDanmuWordCounts(summary.topWords),
    messages: recent,
    messagesTruncated: session.msgCount > recent.length,
    liveSummary: toLiveSummaryDto(readLiveSummary(session.id)),
  };
}

/** 词云图渲染需要的全部数据；场次不存在时由路由返回 404。 */
export interface DanmuWordCloudPayload {
  /** 画布标题：`主播 · 开播时间`。 */
  title: string;
  /** 词频列表；场次没有弹幕时为空数组。 */
  words: DanmuWordCountDto[];
  /** 场次是否已结束；已结束的词云图内容固定，可以长缓存。 */
  ended: boolean;
  /** 中文字体文件路径，未配置时为 undefined。 */
  fontPath?: string;
}

/**
 * 某场次词云图的渲染数据：一次读取场次与弹幕即可完成渲染。
 *
 * 场次不存在时返回 undefined；场次没有弹幕时 `words` 为空数组（由调用方决定话术）。
 */
export function buildDanmuWordCloudPayload(id: number): DanmuWordCloudPayload | undefined {
  const session = readDanmuSession(id);
  if (!session) {
    return undefined;
  }

  const options = loadDanmuWordCloudOptions();
  const words =
    session.msgCount <= 0
      ? []
      : extractSessionWords(
          readSessionMessages(session.id),
          session.streamer,
          options,
          options.topN,
        );

  return {
    title: `${session.streamer} · ${formatSessionTime(session.startedAt)}`,
    words,
    ended: session.endedAt !== null,
    fontPath: options.fontPath,
  };
}

/** 把库里的摘要收成页面只需要的状态和正文。 */
function toLiveSummaryDto(summary: StoredLiveSummary | undefined): DanmuLiveSummaryDto {
  if (!summary || summary.status === null) {
    return { status: null, text: null };
  }
  return {
    status: summary.status,
    text: summary.status === "ok" ? summary.text : null,
  };
}

/** 场次开播时间的中文展示，用于词云图标题。 */
function formatSessionTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return iso;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
