import { createHash } from "node:crypto";

/**
 * WBI mixin key 的重排表（B 站公开算法，64 个索引），用于把 `img_key + sub_key`
 * 打散成 32 位 mixin key。移植自 Boku `wbi.go` 的 `mixinKeyEncTab`。
 */
export const WBI_MIXIN_KEY_ENC_TAB: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** 一对 WBI key。二者都非空才算有效。 */
export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

/** 由 `img_key + sub_key` 计算 32 位 mixin key。 */
export function computeMixinKey(imgKey: string, subKey: string): string {
  return deriveMixinKey(imgKey + subKey);
}

function deriveMixinKey(original: string): string {
  let result = "";
  for (const index of WBI_MIXIN_KEY_ENC_TAB) {
    if (index >= 0 && index < original.length) {
      result += original[index];
    }
  }
  return result.slice(0, 32);
}

/**
 * 与 Go `url.QueryEscape` 一致的编码：先去掉 `! ' ( ) *`，再按 Go 规则百分号编码
 * （空格编码为 `+`，`~` 保留）。不能直接用 `encodeURIComponent`，否则签名不一致。
 */
export function encodeWbiComponent(value: string): string {
  const stripped = value.replace(/[!'()*]/g, "");
  return (
    encodeURIComponent(stripped)
      .replace(/%20/g, "+")
      // encodeURIComponent 不编码 ! ' ( ) * 之外的 ~，这里已保证一致；下面兜底处理仍保留的字符。
      .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  );
}

export interface SignedQuery {
  /** 最终查询串（含 `wts` 与 `w_rid`，可直接拼接到 URL）。 */
  query: string;
}

/**
 * 对参数做 WBI 签名，返回完整查询串。
 *
 * 步骤：加入 `wts`（Unix 秒）→ 按参数名升序排序 → 逐项 `encodeWbiComponent` 拼接 →
 * `w_rid = md5(query + mixinKey)`（小写 hex）→ 追加 `&w_rid=...`。
 *
 * @param params 业务参数（不含 wts / w_rid）
 * @param keys WBI key 对
 * @param nowUnixSeconds Unix 秒时间戳
 */
export function signWbiParams(
  params: Readonly<Record<string, string>>,
  keys: WbiKeys,
  nowUnixSeconds: number,
): SignedQuery {
  const values: Record<string, string> = { ...params, wts: String(Math.floor(nowUnixSeconds)) };
  const names = Object.keys(values).sort();
  const base = names
    .map((name) => `${encodeWbiComponent(name)}=${encodeWbiComponent(values[name])}`)
    .join("&");
  const mixinKey = computeMixinKey(keys.imgKey, keys.subKey);
  const wRid = createHash("md5").update(`${base}${mixinKey}`, "utf8").digest("hex");
  return { query: `${base}&w_rid=${wRid}` };
}

/** 从 WBI key 的图片 URL 中提取文件名（去掉目录与扩展名）。 */
export function extractWbiKeyFromUrl(rawUrl: string): string {
  let raw = rawUrl;
  const slash = raw.lastIndexOf("/");
  if (slash >= 0) {
    raw = raw.slice(slash + 1);
  }
  const dot = raw.lastIndexOf(".");
  if (dot >= 0) {
    raw = raw.slice(0, dot);
  }
  return raw.trim();
}
