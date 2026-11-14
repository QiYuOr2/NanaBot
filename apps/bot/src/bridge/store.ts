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
  /** 出站消息的实际发送方式：被动回复 / 主动发送。 */
  via?: "reply" | "proactive";
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

export interface BridgeState {
  ownerId?: string;
  ownerName?: string;
  /** 最近一条主人入站消息的完整上下文，被动回复要用。 */
  lastInbound?: IncomingMessage;
  candidates: BridgeCandidate[];
  messages: BridgeMessageRecord[];
  nextSeq: number;
}

const MAX_MESSAGES = 300;
const MAX_CANDIDATES = 20;

function emptyState(): BridgeState {
  return { candidates: [], messages: [], nextSeq: 1 };
}

function messageTime(message: IncomingMessage): string {
  return message.timestamp ? new Date(message.timestamp).toISOString() : new Date().toISOString();
}

/**
 * 桥接状态的文件存储（项目 db/ 下按账号一个 JSON）。
 * 只有主人的私聊会进来，量很小；写入用临时文件 + rename 保证原子性。
 */
export class BridgeStore {
  readonly filePath: string;
  private inboundWaiters = new Set<() => void>();

  constructor(options: { rootDir: string; accountId: string }) {
    this.filePath = join(options.rootDir, "db", `bridge-${options.accountId}.json`);
  }

  read(): BridgeState {
    let parsed: Partial<BridgeState>;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<BridgeState>;
    } catch {
      return emptyState();
    }
    return {
      ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : undefined,
      ownerName: typeof parsed.ownerName === "string" ? parsed.ownerName : undefined,
      lastInbound: parsed.lastInbound,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      nextSeq: typeof parsed.nextSeq === "number" && parsed.nextSeq >= 1 ? parsed.nextSeq : 1,
    };
  }

  private write(state: BridgeState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
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

  recordOutbound(text: string, via: "reply" | "proactive", error?: string): BridgeMessageRecord {
    const state = this.read();
    const record: BridgeMessageRecord = {
      seq: state.nextSeq,
      direction: "out",
      text,
      at: new Date().toISOString(),
      via,
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
}
