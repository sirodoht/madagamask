import { UserError } from "./validation.ts";
import type { Storage } from "./vault.ts";
export const PHISHING_SOURCE =
  "https://raw.githubusercontent.com/phishdestroy/destroylist/main/list.json";
export type Snapshot = { updatedAt: number; domains: string[] };
export type Protection = {
  status: "current" | "stale" | "unavailable";
  updatedAt: number;
  count: number;
  source: string;
};
export function parseDomains(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 400_000)
    throw new UserError("Invalid phishing feed.");
  const domains = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length > 253 ||
      !/^[a-zA-Z0-9_.-]+$/.test(entry) ||
      !entry.includes(".")
    )
      throw new UserError("Invalid domain in phishing feed.");
    domains.add(entry.toLowerCase().replace(/\.$/, ""));
  }
  return [...domains];
}
export function blockedHost(host: string, domains: Set<string>) {
  let candidate = host.toLowerCase().replace(/\.$/, "");
  while (candidate.includes(".")) {
    if (domains.has(candidate)) return true;
    candidate = candidate.slice(candidate.indexOf(".") + 1);
  }
  return false;
}
export class Phishing {
  private storage: Storage;
  private domains = new Set<string>();
  private updatedAt = 0;
  private ready: Promise<void>;
  constructor(storage: Storage, bundled?: () => Promise<Snapshot>) {
    this.storage = storage;
    this.ready = this.load(bundled);
  }
  private async load(bundled?: () => Promise<Snapshot>) {
    try {
      const cached = (await this.storage.get("phishing")) as
        | Snapshot
        | undefined;
      const data = cached ?? (await bundled?.());
      if (data) {
        if (
          !Number.isFinite(data.updatedAt) ||
          data.updatedAt > Date.now() + 60_000
        )
          throw new Error();
        this.domains = new Set(parseDomains(data.domains));
        this.updatedAt = data.updatedAt;
      }
    } catch {
      this.domains.clear();
      this.updatedAt = 0;
    }
  }
  async view(): Promise<Protection> {
    await this.ready;
    return {
      status: !this.updatedAt
        ? "unavailable"
        : Date.now() - this.updatedAt > 86_400_000
          ? "stale"
          : "current",
      updatedAt: this.updatedAt,
      count: this.domains.size,
      source: PHISHING_SOURCE,
    };
  }
  async check(origin: string) {
    await this.ready;
    if (blockedHost(new URL(origin).hostname, this.domains))
      throw new UserError(
        "This site is on the phishing blocklist. Wallet requests are blocked.",
      );
    return this.view();
  }
  async update() {
    await this.ready;
    const response = await fetch(PHISHING_SOURCE, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !response.body)
      throw new UserError(
        "Phishing update unavailable. Existing protection data was preserved.",
      );
    const reader = response.body.getReader();
    let body = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 8_388_608) {
          await reader.cancel();
          throw new UserError(
            "Phishing feed is too large. Existing data was preserved.",
          );
        }
        body += decoder.decode(next.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const domains = parseDomains(JSON.parse(body));
    const updatedAt = Date.now();
    await this.storage.set("phishing", { updatedAt, domains });
    this.domains = new Set(domains);
    this.updatedAt = updatedAt;
    return this.view();
  }
}
