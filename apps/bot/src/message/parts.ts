export type MessagePart =
  | { type: "text"; text: string; data: { text: string } }
  | { type: "atAll"; data: { qq: "all" } }
  | { type: "image"; source: string | Uint8Array; data: { file: string | Uint8Array } };

export const textPart = (text: string): MessagePart => ({ type: "text", text, data: { text } });
export const atAllPart = (): MessagePart => ({ type: "atAll", data: { qq: "all" } });
export const imagePart = (source: string | Uint8Array): MessagePart => ({
  type: "image",
  source,
  data: { file: source },
});

export function messageText(parts: readonly MessagePart[]): string {
  return parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}
