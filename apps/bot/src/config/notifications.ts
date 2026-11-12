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
