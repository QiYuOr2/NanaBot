import { createTransport, type Transporter } from "nodemailer";
import { ENV_KEYS } from "@nana/constants";
import type { Notifier, NotifyMessage } from "./types.ts";

/** SMTP 服务器配置；缺省使用 QQ 邮箱 587 端口（STARTTLS）。 */
export interface EmailSmtpOptions {
  host?: string;
  port?: number;
  secure?: boolean;
}

/** 邮件通知通道的配置。 */
export interface EmailNotifierOptions {
  /** 收件人地址。 */
  address: string;
  /** 抄送地址。 */
  cc?: string[];
  smtp?: EmailSmtpOptions;
}

interface MailGateway {
  sendMail(data: {
    from: string;
    to: string;
    cc?: string[];
    subject: string;
    text: string;
  }): Promise<unknown>;
  close?(): void;
}

interface EmailNotifierDeps {
  /** 测试注入点：替换真实 SMTP 网关。 */
  createTransport?: (config: TransportConfig) => MailGateway;
}

interface TransportConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user?: string; pass?: string };
}

const DEFAULT_SMTP: Required<EmailSmtpOptions> = {
  host: "smtp.qq.com",
  port: 587,
  secure: false,
};

/** 从配置与 .env 组装 SMTP 传输配置。 */
function buildTransportConfig(options: EmailNotifierOptions): TransportConfig {
  const smtp = { ...DEFAULT_SMTP, ...options.smtp };
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: process.env[ENV_KEYS.SERVER_EMAIL],
      pass: process.env[ENV_KEYS.SERVER_EMAIL_PASSWORD],
    },
  };
}

/**
 * 创建底层 SMTP 传输器（不建立连接 / 不发信）。
 * 供本地脚本、探活或 `transporter.verify()` 使用；`createEmailNotifier` 内部也复用同一套配置。
 */
export function createEmailTransport(options: EmailNotifierOptions): Transporter {
  return createTransport(buildTransportConfig(options));
}

/** 创建基于 SMTP 的邮件通知通道。 */
export function createEmailNotifier(
  options: EmailNotifierOptions,
  deps: EmailNotifierDeps = {},
): Notifier {
  const user = process.env[ENV_KEYS.SERVER_EMAIL];

  if (!user) {
    console.warn("[emailNotifier] 缺少环境变量 SERVER_EMAIL，邮件通知将无法发送。");
  }

  const create =
    deps.createTransport ??
    ((config: TransportConfig) => createTransport(config) as unknown as MailGateway);
  const transporter = create(buildTransportConfig(options));

  return {
    async send(message: NotifyMessage) {
      try {
        await transporter.sendMail({
          from: user ?? options.address,
          to: options.address,
          cc: options.cc,
          subject: message.subject,
          text: message.text,
        });
      } catch (error) {
        console.error("[emailNotifier] 发送邮件失败", error);
      }
    },
    async close() {
      transporter.close?.();
    },
  };
}
