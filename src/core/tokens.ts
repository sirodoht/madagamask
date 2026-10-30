import {
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  type Hex,
  maxUint256,
  parseUnits,
} from "viem";
import { client, type Networks, verifyChain } from "./networks.ts";
import { address } from "./transactions.ts";
import { integer, record, text, UserError } from "./validation.ts";
import type { Storage } from "./vault.ts";
export type Token = {
  chainId: number;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
};
export function tokenAmount(value: unknown, decimals: number): bigint {
  const input = text(value, "token amount", 300);
  if (
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(input) ||
    (input.split(".")[1]?.length ?? 0) > decimals
  )
    throw new UserError(`Use no more than ${decimals} decimal places.`);
  const amount = parseUnits(input, decimals);
  if (amount <= 0n || amount > maxUint256)
    throw new UserError("Invalid token amount.");
  return amount;
}
function metadata(value: unknown, label: string, max: number) {
  const result = text(value, label, max);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject hidden control characters in untrusted metadata.
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(result))
    throw new UserError("Token metadata contains hidden control characters.");
  return result;
}
export class Tokens {
  private storage: Storage;
  private networks: Networks;
  private items: Token[] = [];
  private ready: Promise<void>;
  constructor(storage: Storage, networks: Networks) {
    this.storage = storage;
    this.networks = networks;
    this.ready = this.load();
  }
  private async load() {
    const saved = await this.storage.get("tokens");
    if (saved === undefined) return;
    const data = record(saved);
    if (
      data.version !== 1 ||
      !Array.isArray(data.items) ||
      data.items.length > 100
    )
      throw new UserError("Unsupported token data.");
    this.items = data.items.map((value) => {
      const t = record(value);
      return {
        chainId: integer(t.chainId, 1, Number.MAX_SAFE_INTEGER),
        address: address(t.address),
        name: metadata(t.name, "token name", 80),
        symbol: metadata(t.symbol, "token symbol", 20),
        decimals: integer(t.decimals, 0, 255),
      };
    });
  }
  async list() {
    await this.ready;
    const chain = await this.networks.selected();
    return structuredClone(
      this.items.filter((item) => item.chainId === chain.id),
    );
  }
  async add(value: unknown) {
    await this.ready;
    const tokenAddress = address(value);
    const network = await this.networks.selected();
    const revision = this.networks.revision;
    await verifyChain(network);
    const rpc = client(network);
    if (!(await rpc.getBytecode({ address: tokenAddress })))
      throw new UserError("No contract exists at this address.");
    const [name, symbol, decimals] = await Promise.all([
      rpc.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "name",
      }),
      rpc.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      rpc.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    ]);
    if (revision !== this.networks.revision)
      throw new UserError("Network changed. Import again.");
    const token: Token = {
      chainId: network.id,
      address: tokenAddress,
      name: metadata(name, "token name", 80),
      symbol: metadata(symbol, "token symbol", 20),
      decimals: integer(decimals, 0, 255),
    };
    const next = [
      ...this.items.filter(
        (item) =>
          !(item.chainId === network.id && item.address === tokenAddress),
      ),
      token,
    ];
    if (next.length > 100) throw new UserError("Token limit reached.");
    await this.storage.set("tokens", { version: 1, items: next });
    this.items = next;
    return token;
  }
  async remove(value: unknown) {
    await this.ready;
    const target = address(value);
    const network = await this.networks.selected();
    const next = this.items.filter(
      (item) => !(item.chainId === network.id && item.address === target),
    );
    await this.storage.set("tokens", { version: 1, items: next });
    this.items = next;
  }
  async get(value: unknown) {
    const target = address(value);
    const token = (await this.list()).find((item) => item.address === target);
    if (!token) throw new UserError("Import this token first.");
    return token;
  }
  async balance(value: unknown, owner: Address) {
    const token = await this.get(value);
    const network = await this.networks.selected();
    await verifyChain(network);
    const result = await client(network).readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
    return {
      address: owner,
      chainId: network.id,
      token: token.address,
      balance: formatUnits(result, token.decimals),
      symbol: token.symbol,
    };
  }
  async transfer(value: unknown, to: unknown, amount: unknown) {
    const token = await this.get(value);
    return {
      to: token.address,
      amount: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [address(to), tokenAmount(amount, token.decimals)],
      }),
    };
  }
}
export function interpret(data: Hex, tokenAddress: Address) {
  if (data === "0x")
    return {
      kind: "native",
      summary:
        "Native asset transfer. The receiving address may execute contract code.",
      warning:
        "Expected asset movement is the requested amount plus fees; actual contract effects are not verified.",
    };
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    if (decoded.functionName === "approve") {
      const [spender, value] = decoded.args;
      return {
        kind: "approval",
        summary: `Token ${tokenAddress}: allow ${spender} to spend ${value === maxUint256 ? "UNLIMITED tokens" : `${value} base units`}.`,
        warning:
          "This grants spending permission, not a transfer. A malicious spender can use this allowance later.",
        spender,
        allowance: value.toString(),
      };
    }
    if (decoded.functionName === "transfer") {
      const [recipient, value] = decoded.args;
      return {
        kind: "token-transfer",
        summary: `Token ${tokenAddress}: request a transfer of ${value} base units to ${recipient}.`,
        warning:
          "Decoded intent only. Tokens may charge fees or behave unexpectedly.",
      };
    }
    if (decoded.functionName === "transferFrom")
      return {
        kind: "transfer-from",
        summary: `Token ${tokenAddress}: transfer from ${decoded.args[0]} to ${decoded.args[1]} (${decoded.args[2]} base units).`,
        warning:
          "This spends an existing allowance. Actual effects are unverified.",
      };
  } catch {
    /* Unknown selector or ABI mismatch. */
  }
  return {
    kind: "unknown",
    summary: "Unknown contract interaction.",
    warning:
      "Asset changes and permissions could not be determined. Read the raw data and trust the requesting site before proceeding.",
  };
}
export function editAllowance(data: Hex, value: unknown) {
  const decoded = decodeFunctionData({ abi: erc20Abi, data });
  if (decoded.functionName !== "approve")
    throw new UserError("This is not a supported token approval.");
  const input = text(value, "allowance", 78);
  if (!/^\d+$/.test(input) || BigInt(input) > maxUint256)
    throw new UserError("Invalid allowance in base units.");
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [decoded.args[0], BigInt(input)],
  });
}
