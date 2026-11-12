import { Structs, type Receive, type SendMessageSegment } from "node-napcat-ts";
import { NapcatError } from "./errors.ts";
import type { NapcatMessagePart } from "./types.ts";

export function toNapcatSegments(parts: readonly NapcatMessagePart[]): SendMessageSegment[] {
  return parts.map((part) => {
    switch (part.type) {
      case "text":
        return Structs.text(part.text);
      case "image":
        return Structs.image(
          typeof part.source === "string" ? part.source : Buffer.from(part.source),
        );
      case "atAll":
        return Structs.at("all");
    }
  });
}

export function readIncomingText(message: Receive[keyof Receive][]): {
  text: string;
} {
  const text = message
    .filter((segment): segment is Receive["text"] => segment.type === "text")
    .map((segment) => segment.data.text)
    .join("")
    .trim();
  return { text };
}

export function hasAtBot(message: Receive[keyof Receive][], selfId: number): boolean {
  return message.some(
    (segment) => segment.type === "at" && String(segment.data.qq) === String(selfId),
  );
}

export function requireNumericId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new NapcatError(`${label} 必须是有效的 QQ 数字 ID。`);
  }
  return id;
}
