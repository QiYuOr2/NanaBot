import { BilibiliApiError } from "../errors.ts";

/**
 * 动态接口的错误类别。
 *
 * 用于让上层区分「可重试的暂时性错误」和「不应掩盖为空的失败」，从而决定退避与日志。
 * - `network`：fetch 抛错、超时、DNS/连接失败等传输层问题。
 * - `http`：HTTP 状态码非 2xx。
 * - `business`：HTTP 成功但业务码非 0（含未知业务错误）。
 * - `signature`：签名相关错误（如 -352），可刷新 WBI key 后重试。
 * - `risk-control`：风控（如 -412、-799），不应重试也不应视作空。
 * - `parse`：响应结构无法解析（非 JSON、字段缺失等）。
 */
export type BilibiliDynamicErrorKind =
  | "network"
  | "http"
  | "business"
  | "signature"
  | "risk-control"
  | "parse";

/** 动态 API 专用错误，携带错误类别与 B 站业务码，便于上层分类处理。 */
export class BilibiliDynamicError extends BilibiliApiError {
  constructor(
    message: string,
    readonly kind: BilibiliDynamicErrorKind,
    code?: number,
  ) {
    super(message, code);
    this.name = "BilibiliDynamicError";
  }
}

/** 是否属于可以刷新 WBI key 后重试的签名错误。 */
export function isSignatureError(error: unknown): error is BilibiliDynamicError {
  return error instanceof BilibiliDynamicError && error.kind === "signature";
}

/**
 * 是否属于风控 / 封禁类错误。
 *
 * 风控错误不能被当成「没有新动态」，上层应保留游标并退避，而不是推进同步状态。
 */
export function isRiskControlError(error: unknown): error is BilibiliDynamicError {
  return error instanceof BilibiliDynamicError && error.kind === "risk-control";
}
