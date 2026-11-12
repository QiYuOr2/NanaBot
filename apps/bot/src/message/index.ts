export {
  createMessageFeature,
  builtInCommands,
  commandRegistryApi,
  getCommand,
  listCommands,
  matchMessageRules,
  matchesRule,
  parseCommand,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type MessageFeatureOptions,
} from "./engine.ts";
export { parseMessageConfig } from "./config.ts";
export { atAllPart, imagePart, textPart, type MessagePart } from "./parts.ts";
export {
  NapcatMessageAdapter,
  OfficialMessageAdapter,
  normalizeNapcatMessage,
  normalizeOfficialMessage,
} from "./platform.ts";
export type {
  IncomingMessage,
  MessageConfig,
  MessagePlatform,
  MessagePlatformAdapter,
  MessageReply,
  MessageRule,
  MessageRuntime,
  MessageScene,
  MessageReplyContext,
  MessageTarget,
  OutgoingMessage,
  PlatformConnectionState,
} from "./types.ts";
