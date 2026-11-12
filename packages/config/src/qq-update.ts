import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import { z } from "zod";
import { NANA_CONFIG_FILE } from "@nana/constants";
import { resolveProjectRoot } from "@nana/utils";
import { parseQQConfig } from "./qq-schema.ts";
import { describeQQGroups } from "./qq-groups.ts";

export class QQGroupConflictError extends Error {}
export const QQGroupMappingSchema = z
  .object({
    accountId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    groupId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .refine((id) => Number.isSafeInteger(Number(id))),
    openid: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((id) => !/\s/.test(id), "群标识不能包含空白字符"),
    name: z.string().trim().max(100),
    expectedOpenid: z.string().nullable(),
  })
  .strict();

/** 只改指定账号的单个群，保留 YAML 注释及其他字段，原子替换避免 bot 读到半份文件。 */
export function saveQQGroupMapping(input: unknown, rootDir?: string): void {
  const value = QQGroupMappingSchema.parse(input);
  const file = join(resolveProjectRoot(rootDir), NANA_CONFIG_FILE);
  const before = readFileSync(file, "utf8");
  const doc = parseDocument(before);
  if (doc.errors.length) throw new Error("配置文件格式错误，请先修复 YAML。");
  const raw: unknown = doc.toJS();
  const qq = parseQQConfig(raw);
  const index = qq.accounts.findIndex((entry) => entry.id === value.accountId);
  if (index < 0) throw new Error("未找到该官方 QQ 账号。");
  const account = qq.accounts[index];
  if (account.provider !== "official")
    throw new Error("NapCat 账号使用 QQ 群号，无需配置官方群映射。");
  const group = describeQQGroups(raw)
    .find((entry) => entry.id === value.accountId)
    ?.groups.find((entry) => entry.id === value.groupId);
  if (!group) throw new Error("该群未在当前账号的通知目标中配置。");
  if ((account.groups[value.groupId]?.openid ?? null) !== value.expectedOpenid) {
    throw new QQGroupConflictError("群映射已被其他操作修改，请刷新后重试。");
  }
  if (
    Object.entries(account.groups).some(
      ([id, mapping]) => id !== value.groupId && mapping.openid === value.openid,
    )
  ) {
    throw new Error("该 group_openid 已绑定当前账号的另一个群，请核对后再保存。");
  }
  const groupsPath = ["accounts", index, "groups"];
  const groupsNode = doc.getIn(groupsPath, true);
  const existingKey = isMap(groupsNode)
    ? groupsNode.items.find(
        (item) => isScalar(item.key) && String(item.key.value) === value.groupId,
      )?.key
    : undefined;
  const groupKey = isScalar(existingKey) ? existingKey.value : value.groupId;
  const path = [...groupsPath, groupKey];
  doc.setIn([...path, "openid"], value.openid);
  if (value.name) doc.setIn([...path, "name"], value.name);
  else doc.deleteIn([...path, "name"]);
  // 不允许当前写入意外损坏可解析的 QQ 配置。
  parseQQConfig(doc.toJS());
  if (readFileSync(file, "utf8") !== before)
    throw new QQGroupConflictError("配置文件已变更，请刷新后重试。");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, doc.toString(), { mode: statSync(file).mode & 0o777 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
