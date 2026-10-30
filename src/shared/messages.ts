import type { WalletStatus } from "../core/status.ts";

export type Request =
  | { version: 1; type: "site:request"; request: unknown }
  | {
      version: 1;
      type: "app:command";
      action: string;
      params: Record<string, unknown>;
    }
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
  const command = value as Record<string, unknown>;
  if (command.version === 1 && command.type === "site:request") {
    if (
      keys.length !== 3 ||
      !command.request ||
      typeof command.request !== "object"
    )
      return undefined;
    try {
      if (JSON.stringify(value).length > 32768) return undefined;
    } catch {
      return undefined;
    }
    return { version: 1, type: "site:request", request: command.request };
  }
  if (command.version === 1 && command.type === "app:command") {
    if (
      keys.length !== 4 ||
      typeof command.action !== "string" ||
      command.action.length > 60 ||
      !command.params ||
      typeof command.params !== "object" ||
      Array.isArray(command.params)
    )
      return undefined;
    try {
      if (JSON.stringify(value).length > 32768) return undefined;
    } catch {
      return undefined;
    }
    return {
      version: 1,
      type: "app:command",
      action: command.action,
      params: command.params as Record<string, unknown>,
    };
  }
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
