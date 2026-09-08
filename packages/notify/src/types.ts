/** 一次通知的通用载荷。通道只负责把 subject/text 发出去，不关心业务语义。 */
export interface NotifyMessage {
  subject: string;
  text: string;
}

/**
 * 通知通道接口。
 *
 * 任何实现内部都应吞掉发送异常并做日志记录（`send` 不向上抛），
 * 以免通道自身的问题影响主流程。`close` 可选，用于释放底层资源。
 */
export interface Notifier {
  send(message: NotifyMessage): Promise<void>;
  close?(): Promise<void>;
}
