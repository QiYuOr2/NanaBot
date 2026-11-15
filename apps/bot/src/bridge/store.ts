import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { IncomingMessage } from "../message/types.ts";

/** 桥接记录的一条消息（入站为主人发来，出站为 Rei 经 bot 发出）。 */
export interface BridgeMessageRecord {
  seq: number;
  direction: "in" | "out";
  text: string;
  /** ISO 时间。 */
  at: string;
  senderName?: string;
  /** 群消息的发送者标识（member_openid 等）；私聊记录不带。 */
  senderId?: string;
  /** 群入站是否为 @ 到 bot 的消息（false 表示主人未 @ 的普通发言，仅主人消息会出现）；私聊记录不带。 */
  atBot?: boolean;
  /** 出站消息的实际发送方式：被动回复 / 主动发送。 */
  via?: "reply" | "proactive";
  /** 出站消息的形态：纯文本 / Markdown / 图片（可带说明）/ 语音。缺省视为 text。 */
  kind?: "text" | "markdown" | "image" | "voice";
  /** 出站发送失败时的错误摘要。 */
  error?: string;
}

/** 绑定前的候选发送者：主人还没确认 openid 时，先把私聊发送者记下来供核对。 */
export interface BridgeCandidate {
  senderId: string;
  senderName?: string;
  text: string;
  at: string;
  /** 绑定时提升为 lastInbound，让第一条回复也能走被动回复窗口。 */
  message: IncomingMessage;
}

/** 一个群的桥接状态：只收录 @ 到 bot 的消息与 Rei 在该群的发言，seq 在全部群之间共享递增。 */
export interface BridgeGroupState {
  groupId: string;
  groupName?: string;
  /** 最近一条该群入站消息的完整上下文，被动回复要用。 */
  lastInbound?: IncomingMessage;
  messages: BridgeMessageRecord[];
}

export interface BridgeState {
  ownerId?: string;
  ownerName?: string;
  /** 最近一条主人入站消息的完整上下文，被动回复要用。 */
  lastInbound?: IncomingMessage;
  candidates: BridgeCandidate[];
  messages: BridgeMessageRecord[];
  nextSeq: number;
  /** 已发现的群（键为 group_openid）。不限定群：任何群里 @ 到 bot 都会建档。 */
  groups: Record<string, BridgeGroupState>;
  groupNextSeq: number;
  /**
   * 每个群里「主人本人」的发送者标识（member_openid 与私聊 openid 可能不同，需要时单独绑定）。
   * 绑定后主人在该群未 @ 的普通发言也会被记录，供 Rei 自行判断是否主动回复。
   */
  groupOwners: Record<string, string>;
}

const MAX_MESSAGES = 300;
const MAX_CANDIDATES = 20;

function messageTime(message: IncomingMessage): string {
  return message.timestamp ? new Date(message.timestamp).toISOString() : new Date().toISOString();
}

/**
 * 桥接状态的文件存储（项目 db/ 下按账号分文件）。
 * 私聊（主人）与群聊严格分开存：私聊在 bridge-<accountId>.json，
 * 群聊在 bridge-<accountId>-groups.json，两套 seq 相互独立，
 * 群里的内容不会混进与主人的私聊记录。写入用临时文件 + rename 保证原子性。
 * 旧版把 groups 放在私聊文件里的情况会在首次读取时迁移到群文件。
 */
export class BridgeStore {
  readonly filePath: string;
  readonly groupFilePath: string;
  private inboundWaiters = new Set<() => void>();

  constructor(options: { rootDir: string; accountId: string }) {
    this.filePath = join(options.rootDir, "db", `bridge-${options.accountId}.json`);
    this.groupFilePath = join(options.rootDir, "db", `bridge-${options.accountId}-groups.json`);
  }

  private readJson(path: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  read(): BridgeState {
    const parsed = this.readJson(this.filePath) as Partial<BridgeState>;
    const groupParsed = this.readJson(this.groupFilePath) as Partial<BridgeState>;
    // 群数据以群文件为准；群文件还不存在时回退到旧版私聊文件里的 groups（迁移前的存量）。
    const groupsSource =
      groupParsed.groups && typeof groupParsed.groups === "object"
        ? groupParsed
        : parsed.groups && typeof parsed.groups === "object"
          ? parsed
          : groupParsed;
    return {
      ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : undefined,
      ownerName: typeof parsed.ownerName === "string" ? parsed.ownerName : undefined,
      lastInbound: parsed.lastInbound,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      nextSeq: typeof parsed.nextSeq === "number" && parsed.nextSeq >= 1 ? parsed.nextSeq : 1,
      groups:
        groupsSource.groups &&
        typeof groupsSource.groups === "object" &&
        !Array.isArray(groupsSource.groups)
          ? (groupsSource.groups as Record<string, BridgeGroupState>)
          : {},
      groupNextSeq:
        typeof groupsSource.groupNextSeq === "number" && groupsSource.groupNextSeq >= 1
          ? groupsSource.groupNextSeq
          : 1,
      groupOwners:
        groupsSource.groupOwners &&
        typeof groupsSource.groupOwners === "object" &&
        !Array.isArray(groupsSource.groupOwners)
          ? (groupsSource.groupOwners as Record<string, string>)
          : {},
    };
  }

  private writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tempPath, path);
  }

  private write(state: BridgeState): void {
    const { groups, groupNextSeq, groupOwners, ...privateState } = state;
    this.writeJson(this.filePath, privateState);
    this.writeJson(this.groupFilePath, { groups, groupNextSeq, groupOwners });
  }

  /** 未绑定时记录候选发送者；同一发送者只保留最近一条。 */
  addCandidate(message: IncomingMessage): void {
    const state = this.read();
    state.candidates = state.candidates.filter((item) => item.senderId !== message.senderId);
    state.candidates.push({
      senderId: message.senderId,
      ...(message.senderName ? { senderName: message.senderName } : {}),
      text: message.text,
      at: messageTime(message),
      message,
    });
    state.candidates = state.candidates.slice(-MAX_CANDIDATES);
    this.write(state);
  }

  /** 把某个候选发送者绑定为主人，并提升其消息为最近入站上下文。 */
  bindOwner(senderId: string): BridgeState {
    const state = this.read();
    const candidate = state.candidates.find((item) => item.senderId === senderId);
    if (!candidate && state.ownerId !== senderId) {
      throw new Error(`发送者 ${senderId} 不在候选列表中，拒绝绑定。`);
    }
    state.ownerId = senderId;
    if (candidate) {
      state.ownerName = candidate.senderName;
      state.lastInbound = candidate.message;
      state.candidates = [];
    }
    this.write(state);
    return state;
  }

  recordInbound(message: IncomingMessage): BridgeMessageRecord {
    const state = this.read();
    const record: BridgeMessageRecord = {
      seq: state.nextSeq,
      direction: "in",
      text: message.text,
      at: messageTime(message),
      ...(message.senderName ? { senderName: message.senderName } : {}),
    };
    state.nextSeq += 1;
    state.lastInbound = message;
    state.messages = [...state.messages, record].slice(-MAX_MESSAGES);
    this.write(state);
    this.notifyInbound();
    return record;
  }

  private notifyInbound(): void {
    const waiters = [...this.inboundWaiters];
    this.inboundWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  recordOutbound(
    text: string,
    via: "reply" | "proactive",
    error?: string,
    kind?: "text" | "markdown" | "image" | "voice",
  ): BridgeMessageRecord {
    const state = this.read();
    const record: BridgeMessageRecord = {
      seq: state.nextSeq,
      direction: "out",
      text,
      at: new Date().toISOString(),
      via,
      ...(kind && kind !== "text" ? { kind } : {}),
      ...(error ? { error } : {}),
    };
    state.nextSeq += 1;
    state.messages = [...state.messages, record].slice(-MAX_MESSAGES);
    this.write(state);
    return record;
  }

  messagesAfter(seq: number): BridgeMessageRecord[] {
    return this.read().messages.filter((record) => record.seq > seq);
  }

  /** 记录一条群入站（调用方已保证是 @ 到 bot 的消息）；群不存在时自动建档，不限定群与发送者。 */
  recordGroupInbound(message: IncomingMessage): BridgeMessageRecord {
    const state = this.read();
    const groupId = message.conversationId;
    const group: BridgeGroupState = state.groups[groupId] ?? { groupId, messages: [] };
    const record: BridgeMessageRecord = {
      seq: state.groupNextSeq,
      direction: "in",
      text: message.text,
      at: messageTime(message),
      senderId: message.senderId,
      atBot: message.isAtBot,
      ...(message.senderName ? { senderName: message.senderName } : {}),
    };
    state.groupNextSeq += 1;
    group.lastInbound = message;
    group.messages = [...group.messages, record].slice(-MAX_MESSAGES);
    state.groups[groupId] = group;
    this.write(state);
    this.notifyInbound();
    return record;
  }

  recordGroupOutbound(
    groupId: string,
    text: string,
    via: "reply" | "proactive",
    error?: string,
    kind?: "text" | "markdown" | "image" | "voice",
  ): BridgeMessageRecord {
    const state = this.read();
    const group: BridgeGroupState = state.groups[groupId] ?? { groupId, messages: [] };
    const record: BridgeMessageRecord = {
      seq: state.groupNextSeq,
      direction: "out",
      text,
      at: new Date().toISOString(),
      via,
      ...(kind && kind !== "text" ? { kind } : {}),
      ...(error ? { error } : {}),
    };
    state.groupNextSeq += 1;
    group.messages = [...group.messages, record].slice(-MAX_MESSAGES);
    state.groups[groupId] = group;
    this.write(state);
    return record;
  }

  groupState(groupId: string): BridgeGroupState | undefined {
    return this.read().groups[groupId];
  }

  /** 该群里绑定为主人的发送者标识；未绑定时为 undefined（此时私聊 openid 仍可直接匹配）。 */
  groupOwnerSender(groupId: string): string | undefined {
    return this.read().groupOwners[groupId];
  }

  /** 把某个已在该群记录里出现过的发送者绑定为该群的主人标识。 */
  bindGroupOwner(groupId: string, senderId: string): void {
    const state = this.read();
    const group = state.groups[groupId];
    if (!group) throw new Error(`群 ${groupId} 尚未建档，无法绑定主人标识。`);
    const known = group.messages.some(
      (record) => record.direction === "in" && record.senderId === senderId,
    );
    if (!known) {
      throw new Error(`发送者 ${senderId} 没有在群 ${groupId} 的记录中出现过，拒绝绑定。`);
    }
    state.groupOwners[groupId] = senderId;
    this.write(state);
  }

  groupMessagesAfter(groupId: string, seq: number): BridgeMessageRecord[] {
    const group = this.read().groups[groupId];
    return group ? group.messages.filter((record) => record.seq > seq) : [];
  }

  /** 已发现群的摘要（不含正文），供 Rei 侧列出可参与的群。 */
  listGroups(): { groupId: string; groupName?: string; lastAt?: string; messageCount: number }[] {
    return Object.values(this.read().groups).map((group) => ({
      groupId: group.groupId,
      ...(group.groupName ? { groupName: group.groupName } : {}),
      ...(group.messages.length ? { lastAt: group.messages[group.messages.length - 1]?.at } : {}),
      messageCount: group.messages.length,
    }));
  }

  /** 全部群里最近一条入站的 seq 与所在群；没有任何群入站时为 null。 */
  latestGroupInbound(): { seq: number; groupId: string } | null {
    let latest: { seq: number; groupId: string } | null = null;
    for (const group of Object.values(this.read().groups)) {
      for (let index = group.messages.length - 1; index >= 0; index -= 1) {
        const record = group.messages[index];
        if (record?.direction === "in") {
          if (!latest || record.seq > latest.seq)
            latest = { seq: record.seq, groupId: group.groupId };
          break;
        }
      }
    }
    return latest;
  }

  /** 最近一条入站消息的 seq；没有入站时为 0。轮询方只比较这个数字，不接触内容。 */
  latestInboundSeq(): number {
    const { messages } = this.read();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const record = messages[index];
      if (record?.direction === "in") return record.seq;
    }
    return 0;
  }

  /**
   * 长轮询：等到 latestInboundSeq 超过 after 才返回；waitMs 内没有新入站则返回当前值。
   * waitMs <= 0 时等同于直接读当前值。主要靠 recordInbound 的通知唤醒，
   * 另每 2 秒重读一次兜底，避免通知遗漏时干等到超时。
   */
  async waitForInboundAfter(after: number, waitMs: number): Promise<number> {
    const current = this.latestInboundSeq();
    if (current > after || waitMs <= 0) return current;
    return new Promise<number>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(fallback);
        this.inboundWaiters.delete(onNotify);
        resolve(this.latestInboundSeq());
      };
      const onNotify = () => finish();
      const timer = setTimeout(finish, waitMs);
      const fallback = setInterval(() => {
        if (this.latestInboundSeq() > after) finish();
      }, 2_000);
      this.inboundWaiters.add(onNotify);
    });
  }

  /**
   * 私聊与群合并的长轮询：任一侧的最近入站 seq 超过对应 after 就返回两边的当前值。
   * 群入站与私聊入站共用同一套通知（recordGroupInbound 也会 notifyInbound），兜底重读同上。
   */
  async waitForAnyInboundAfter(
    after: { c2c: number; group: number },
    waitMs: number,
  ): Promise<{ c2c: number; group: number }> {
    const snapshot = () => ({
      c2c: this.latestInboundSeq(),
      group: this.latestGroupInbound()?.seq ?? 0,
    });
    const current = snapshot();
    if (current.c2c > after.c2c || current.group > after.group || waitMs <= 0) return current;
    return new Promise<{ c2c: number; group: number }>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(fallback);
        this.inboundWaiters.delete(onNotify);
        resolve(snapshot());
      };
      const onNotify = () => {
        const next = snapshot();
        if (next.c2c > after.c2c || next.group > after.group) finish();
      };
      const timer = setTimeout(finish, waitMs);
      const fallback = setInterval(onNotify, 2_000);
      this.inboundWaiters.add(onNotify);
    });
  }
}
