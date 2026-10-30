import type { WalletStatus } from "../core/status.ts";

export type Request =
  | { version: 1; type: "app:get-status" }
  | { version: 1; type: "content:hello" };

export type Response =
  | {
      ok: true;
      type: "app:status";
      wallet: WalletStatus;
      instanceId: string;
      startedAt: number;
    }
  | { ok: true; type: "content:ready" }
  | { ok: false; error: "INVALID_REQUEST" | "UNAUTHORIZED" };

export function parseRequest(value: unknown): Request | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("version") ||
    !keys.includes("type")
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    (record.type !== "app:get-status" && record.type !== "content:hello")
  ) {
    return undefined;
  }
  return { version: 1, type: record.type };
}

export function isAppStatus(
  value: unknown,
): value is Extract<Response, { type: "app:status" }> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.ok === true &&
    record.type === "app:status" &&
    typeof record.instanceId === "string" &&
    typeof record.startedAt === "number" &&
    Number.isFinite(record.startedAt) &&
    typeof record.wallet === "object" &&
    record.wallet !== null &&
    "state" in record.wallet &&
    record.wallet.state === "not-created"
  );
}
