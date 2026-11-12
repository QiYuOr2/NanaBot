export type ProjectLogLevel = "debug" | "info" | "warn" | "error" | "unknown";

export interface ProjectLogRow {
  timestamp: string | null;
  timestampClass: string;
  level: ProjectLogLevel | null;
  levelText: string;
  levelClass: string;
  source: string | null;
  sourceClass: string;
  message: string;
}

const TAG_CLASS = "shrink-0 whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-5";
const SOURCE_TAG_CLASS = `${TAG_CLASS} max-w-[12rem] truncate`;

export const LOG_TIMESTAMP_TAG_CLASS = `${TAG_CLASS} bg-[#262626] text-[#b8b8b8]`;

export const LOG_LEVEL_TAG_CLASSES: Record<ProjectLogLevel, string> = {
  debug: `${TAG_CLASS} bg-[#2c3138] text-[#b8c0cc]`,
  info: `${TAG_CLASS} bg-[#0a3f78] text-[#a5d0ff]`,
  warn: `${TAG_CLASS} bg-[#6b3d00] text-[#ffd27a]`,
  error: `${TAG_CLASS} bg-[#6b1f22] text-[#ffa3a6]`,
  unknown: `${TAG_CLASS} bg-[#403a48] text-[#d1c5e2]`,
};

const DEFAULT_SOURCE_TAG_CLASS = `${SOURCE_TAG_CLASS} bg-[#15385e] text-[#9bc7ff]`;

const LOG_SOURCE_TAG_CLASSES = [
  DEFAULT_SOURCE_TAG_CLASS,
  "bg-[#0f4a45] text-[#8ce5d8]",
  "bg-[#3b245e] text-[#c4a5ff]",
  "bg-[#1d4d2e] text-[#91dfa6]",
  "bg-[#5c2b45] text-[#ff9ccc]",
  "bg-[#5a3a12] text-[#ffc477]",
  "bg-[#154a5c] text-[#79d6f2]",
  "bg-[#453b1f] text-[#e3cf7a]",
] as const;

const STRUCTURED_LINE = /^\[([^\]\r\n]+)\] \[([^\]\r\n]+)\] \[([^\]\r\n]+)\] ?(.*)$/;

const LEVEL_TONES: Record<string, ProjectLogLevel> = {
  DEBUG: "debug",
  TRACE: "debug",
  INFO: "info",
  NOTICE: "info",
  WARN: "warn",
  WARNING: "warn",
  ERROR: "error",
  FATAL: "error",
  CRITICAL: "error",
};

export function parseProjectLogRows(content: string): ProjectLogRow[] {
  if (!content) return [];
  const sourceClasses = new Map<string, string>();

  return content.split("\n").map((rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    const match = STRUCTURED_LINE.exec(line);
    if (!match) {
      return {
        timestamp: null,
        timestampClass: LOG_TIMESTAMP_TAG_CLASS,
        level: null,
        levelText: "",
        levelClass: "",
        source: null,
        sourceClass: "",
        message: line,
      };
    }

    const [, timestamp = "", levelText = "", source = "", message = ""] = match;
    const level = LEVEL_TONES[levelText.trim().toUpperCase()] ?? "unknown";
    let sourceClass = sourceClasses.get(source);
    if (!sourceClass) {
      const index = sourceClasses.size % LOG_SOURCE_TAG_CLASSES.length;
      const tone = LOG_SOURCE_TAG_CLASSES[index] ?? DEFAULT_SOURCE_TAG_CLASS;
      sourceClass = `${SOURCE_TAG_CLASS} ${tone}`;
      sourceClasses.set(source, sourceClass);
    }

    return {
      timestamp,
      timestampClass: LOG_TIMESTAMP_TAG_CLASS,
      level,
      levelText,
      levelClass: LOG_LEVEL_TAG_CLASSES[level],
      source,
      sourceClass,
      message,
    };
  });
}
