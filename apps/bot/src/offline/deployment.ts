import { readFileSync } from "node:fs";

/** 部署标记的内容，由部署脚本在重启前写入项目根目录。 */
export interface DeploymentMarker {
  startedAt: string;
  ref?: string;
}

/** 标记超过这个时长视为残留（部署脚本异常退出且未清理），不再影响告警措辞。 */
export const DEPLOYMENT_MARKER_STALE_MS = 30 * 60_000;

/**
 * 读取部署标记；文件不存在、内容不合法或已经过期时返回 undefined。
 * 部署窗口内产生的离线/恢复告警会据此改用「部署中」措辞，避免误报成故障掉线。
 */
export function readDeploymentMarker(
  markerPath: string,
  now: number = Date.now(),
): DeploymentMarker | undefined {
  let parsed: Partial<DeploymentMarker>;
  try {
    parsed = JSON.parse(readFileSync(markerPath, "utf8")) as Partial<DeploymentMarker>;
  } catch {
    return undefined;
  }
  if (typeof parsed.startedAt !== "string") return undefined;
  const startedAt = Date.parse(parsed.startedAt);
  if (!Number.isFinite(startedAt)) return undefined;
  if (now - startedAt > DEPLOYMENT_MARKER_STALE_MS) return undefined;
  if (startedAt - now > 60_000) return undefined;
  return {
    startedAt: parsed.startedAt,
    ref: typeof parsed.ref === "string" && parsed.ref ? parsed.ref : undefined,
  };
}
