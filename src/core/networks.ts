import {
  type Address,
  createPublicClient,
  custom,
  defineChain,
  formatEther,
} from "viem";
import { baseSepolia, mainnet, sepolia } from "viem/chains";
import { integer, record, text, UserError } from "./validation.ts";
import type { Storage } from "./vault.ts";

export type Network = { id: number; name: string; rpc: string; symbol: string };
export const SIGNING_CHAINS = new Set([11155111, 84532, 31337, 1337]);
export const DEFAULT_NETWORKS: Network[] = [sepolia, baseSepolia, mainnet].map(
  (chain) => ({
    id: chain.id,
    name: chain.name,
    rpc: chain.rpcUrls.default.http[0],
    symbol: chain.nativeCurrency.symbol,
  }),
);
export function endpoint(value: unknown): string {
  const input = text(value, "RPC URL", 2048);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UserError("Invalid RPC URL.");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new UserError(
      "RPCs require HTTPS, except localhost. Credentials and fragments are not supported.",
    );
  return url.href;
}
export function parseNetwork(value: unknown): Network {
  const data = record(value);
  return {
    id: integer(data.id, 1, Number.MAX_SAFE_INTEGER),
    name: text(data.name, "network name", 60),
    rpc: endpoint(data.rpc),
    symbol: text(data.symbol, "currency symbol", 12),
  };
}
export async function rpc(
  network: Network,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const id = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch(network.rpc, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new UserError(
      "RPC unavailable or timed out. Check the network and try again.",
    );
  }
  if (!response.ok || !response.body)
    throw new UserError("RPC returned an HTTP error.");
  const reader = response.body.getReader();
  let body = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1_048_576) {
        await reader.cancel();
        throw new UserError("RPC response is too large.");
      }
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(
      "RPC response interrupted or timed out. Check the network and try again.",
    );
  } finally {
    reader.releaseLock();
  }
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(body));
  } catch {
    throw new UserError("Invalid RPC response.");
  }
  if (
    data.id !== id ||
    data.jsonrpc !== "2.0" ||
    data.error ||
    !("result" in data)
  )
    throw new UserError(
      "RPC rejected the request. The network or contract may be unavailable.",
    );
  return data.result;
}
export function client(network: Network) {
  return createPublicClient({
    chain: defineChain({
      id: network.id,
      name: network.name,
      nativeCurrency: {
        name: network.symbol,
        symbol: network.symbol,
        decimals: 18,
      },
      rpcUrls: { default: { http: [network.rpc] } },
    }),
    transport: custom(
      {
        request: ({ method, params }) =>
          rpc(network, method, params as unknown[] | undefined),
      },
      { retryCount: 0 },
    ),
  });
}
export async function verifyChain(network: Network) {
  const id = await client(network).getChainId();
  if (id !== network.id)
    throw new UserError("RPC chain ID does not match this network.");
}
export class Networks {
  private storage: Storage;
  private data = { version: 1, items: DEFAULT_NETWORKS, selected: 11155111 };
  private ready: Promise<void>;
  revision = 0;
  constructor(storage: Storage) {
    this.storage = storage;
    this.ready = this.load();
  }
  private async load() {
    const saved = await this.storage.get("networks");
    if (saved === undefined) return;
    const data = record(saved);
    if (
      data.version !== 1 ||
      !Array.isArray(data.items) ||
      !data.items.length ||
      data.items.length > 30
    )
      throw new UserError("Unsupported network settings. Data was preserved.");
    const items = data.items.map(parseNetwork);
    const selected = integer(data.selected, 1, Number.MAX_SAFE_INTEGER);
    if (!items.some((item) => item.id === selected))
      throw new UserError("Selected network is missing.");
    this.data = { version: 1, items, selected };
  }
  async view() {
    await this.ready;
    return structuredClone(this.data);
  }
  async selected() {
    await this.ready;
    const network = this.data.items.find(
      (item) => item.id === this.data.selected,
    );
    if (!network) throw new UserError("Network not found.");
    return { ...network };
  }
  async select(id: unknown) {
    await this.ready;
    const selected = integer(id, 1, Number.MAX_SAFE_INTEGER);
    if (!this.data.items.some((item) => item.id === selected))
      throw new UserError("Add this network first.");
    const next = { ...this.data, selected };
    await this.storage.set("networks", next);
    this.data = next;
    this.revision += 1;
  }
  async add(value: unknown) {
    await this.ready;
    const network = parseNetwork(value);
    await verifyChain(network);
    if (
      this.data.items.length >= 30 &&
      !this.data.items.some((item) => item.id === network.id)
    )
      throw new UserError("Network limit reached.");
    const next = {
      ...this.data,
      items: [
        ...this.data.items.filter((item) => item.id !== network.id),
        network,
      ],
    };
    await this.storage.set("networks", next);
    this.data = next;
    this.revision += 1;
  }
  async balance(address: Address) {
    const network = await this.selected();
    const revision = this.revision;
    await verifyChain(network);
    const amount = await client(network).getBalance({ address });
    if (revision !== this.revision)
      throw new UserError("Network changed. Refresh the balance.");
    return {
      address,
      chainId: network.id,
      amount: formatEther(amount),
      symbol: network.symbol,
      updatedAt: Date.now(),
    };
  }
}
