export type StatusCheckResult = "ok" | "degraded" | "error";

export interface PublicStatusChecks {
  bot: "ok" | "error";
  channels: StatusCheckResult;
  storage: "ok" | "error";
}

export interface PublicStatusResponse {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  checks: PublicStatusChecks;
}
