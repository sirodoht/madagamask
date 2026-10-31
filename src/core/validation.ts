export class UserError extends Error {}

// RPC libraries wrap transport errors. Expose only our own user-facing text,
// never raw provider messages, URLs, request bodies, or transaction payloads.
export function userErrorMessage(error: unknown, fallback: string): string {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof UserError) return error.message;
    seen.add(error);
    error = error.cause;
  }
  return fallback;
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new UserError("Invalid request.");
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new UserError(`Invalid ${label}.`);
  return value;
}

export function integer(value: unknown, min: number, max: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    throw new UserError("Invalid number.");
  return value as number;
}
