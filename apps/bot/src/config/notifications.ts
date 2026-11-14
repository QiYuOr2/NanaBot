import { z } from "zod";

const notice = (message: string) =>
  z
    .object({
      enabled: z.boolean().default(true),
      messageTemplate: z.string().trim().min(1).default(message),
    })
    .prefault({});

const schema = z.object({
  botNotifications: z
    .object({
      online: notice("我来了~"),
      offline: notice("我溜了~"),
    })
    .prefault({}),
});

export function parseBotNotifications(config: unknown) {
  return schema.parse(config).botNotifications;
}

/**
 * 部署窗口内的上/下线提示替换文案：与离线告警的部署措辞保持一致，
 * 带上部署版本，让管理群里一眼能分清是计划内重启而不是故障。
 */
export function renderDeploymentNotice(
  kind: "online" | "offline",
  deployment: { ref?: string },
): string {
  const version = deployment.ref ? `（部署版本: ${deployment.ref}）` : "";
  return kind === "offline"
    ? `部署新版本中，我先下去一下，马上回来~${version}`
    : `部署完成，我回来啦~${version}`;
}

export function renderBotNotice(
  notice: { enabled: boolean; messageTemplate: string },
  account: { id: string; name: string; provider: string },
): string | undefined {
  if (!notice.enabled) return undefined;
  const variables: Record<string, string> = {
    accountId: account.id,
    accountName: account.name,
    provider: account.provider,
  };
  return notice.messageTemplate.replace(
    /\{(accountId|accountName|provider)\}/g,
    (_, key: string) => variables[key],
  );
}
