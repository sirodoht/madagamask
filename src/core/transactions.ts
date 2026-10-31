import {
  type Address,
  formatEther,
  getAddress,
  type Hex,
  isAddress,
  keccak256,
  parseEther,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import {
  client,
  type Network,
  type Networks,
  SIGNING_CHAINS,
  verifyChain,
} from "./networks.ts";
import { interpret } from "./tokens.ts";
import { text, UserError } from "./validation.ts";
import type { Storage, Vault } from "./vault.ts";

export type Activity = {
  hash: Hex;
  chainId: number;
  from: Address;
  to: Address;
  value: string;
  data: Hex;
  nonce: number;
  gas: string;
  maxFee?: string;
  priority?: string;
  gasPrice?: string;
  createdAt: number;
  status:
    | "submitting"
    | "pending"
    | "confirmed"
    | "reverted"
    | "unknown"
    | "replaced"
    | "unseen";
  blockHash?: Hex;
  blockNumber?: string;
  replaces?: Hex;
  error?: string;
};
export type Preview = {
  asset?: {
    recipient: Address;
    amount: string;
    symbol: string;
    contract: Address;
  };
  interpretation: ReturnType<typeof interpret>;
  simulation: { status: "passed" | "unavailable"; message: string };
  id: string;
  from: Address;
  to: Address;
  amount: string;
  fee: string;
  total: string;
  network: string;
  chainId: number;
  symbol: string;
  data: Hex;
  expiresAt: number;
  replacement: boolean;
};
export type Draft = {
  public: Preview;
  network: Network;
  epoch: number;
  revision: number;
  nonce: number;
  value: bigint;
  gas: bigint;
  maxFee?: bigint;
  priority?: bigint;
  gasPrice?: bigint;
  replaces?: Hex;
};
export function amount(value: unknown, zero = false): bigint {
  const input = text(value, "amount", 100);
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(input))
    throw new UserError("Use a decimal amount with at most 18 decimal places.");
  const result = parseEther(input);
  if ((!zero && result === 0n) || result >= 2n ** 256n)
    throw new UserError("Invalid amount.");
  return result;
}
export function address(value: unknown): Address {
  const input = text(value, "recipient", 42);
  if (!isAddress(input))
    throw new UserError(
      "Enter a valid Ethereum address with a valid checksum.",
    );
  return getAddress(input);
}
export function hexData(value: unknown): Hex {
  if (value === undefined) return "0x";
  const input = text(value, "transaction data", 32_770);
  if (!/^0x([0-9a-fA-F]{2})*$/.test(input))
    throw new UserError("Invalid transaction data.");
  return input as Hex;
}
function maxFee(a: bigint, b: bigint) {
  // Math.max cannot accept bigint amounts.
  return a > b ? a : b;
}
export class Transactions {
  private storage: Storage;
  private vault: Vault;
  private networks: Networks;
  private drafts = new Map<string, Draft>();
  private generation = 0;
  private activity: Activity[] = [];
  private ready: Promise<void>;
  constructor(storage: Storage, vault: Vault, networks: Networks) {
    this.storage = storage;
    this.vault = vault;
    this.networks = networks;
    this.ready = this.load();
  }
  private async load() {
    const saved = await this.storage.get("activity");
    if (saved === undefined) return;
    if (
      !saved ||
      typeof saved !== "object" ||
      !("version" in saved) ||
      saved.version !== 1 ||
      !("items" in saved) ||
      !Array.isArray(saved.items) ||
      saved.items.length > 1000
    )
      throw new UserError("Unsupported activity data. It has been preserved.");
    // Public local storage is extension-owned; validate fields used for RPC and signing.
    this.activity = saved.items.map((value: Activity) => {
      if (
        !/^0x[0-9a-fA-F]{64}$/.test(value.hash) ||
        !Number.isSafeInteger(value.chainId) ||
        !Number.isSafeInteger(value.nonce) ||
        value.nonce < 0 ||
        !Number.isFinite(value.createdAt)
      )
        throw new UserError("Invalid activity data.");
      address(value.from);
      address(value.to);
      hexData(value.data);
      BigInt(value.value);
      BigInt(value.gas);
      return value;
    });
  }
  invalidate() {
    this.generation += 1;
    this.drafts.clear();
  }
  async list() {
    await this.ready;
    return structuredClone(this.activity);
  }
  private async persist(items: Activity[]) {
    await this.storage.set("activity", { version: 1, items });
    this.activity = items;
  }
  private async save(entry: Activity) {
    await this.persist(
      [
        entry,
        ...this.activity.filter((item) => item.hash !== entry.hash),
      ].slice(0, 1000),
    );
  }
  async prepare(
    toValue: unknown,
    value: unknown,
    dataValue?: unknown,
    replacement?: Activity,
  ): Promise<Preview> {
    await this.ready;
    const generation = this.generation;
    const network = await this.networks.selected();
    if (!SIGNING_CHAINS.has(network.id))
      throw new UserError(
        "Signing is disabled on this network. This alpha supports Ethereum, Sepolia, Base Sepolia, and local chains 31337/1337 only.",
      );
    const account = this.vault.account();
    const epoch = this.vault.generation();
    const revision = this.networks.revision;
    const to = address(toValue);
    const data = hexData(dataValue);
    const quantity = amount(value, data !== "0x" || !!replacement);
    await verifyChain(network);
    const rpc = client(network);
    const balance = await rpc.getBalance({ address: account.address });
    if (balance <= quantity)
      throw new UserError(
        "Insufficient balance for the amount and network fee.",
      );
    const unresolved = this.activity.some(
      (item) =>
        item.chainId === network.id &&
        item.from === account.address &&
        ["submitting", "unknown", "unseen"].includes(item.status),
    );
    if (unresolved && !replacement)
      throw new UserError(
        "A previous submission is uncertain. Refresh activity and resolve it before sending again.",
      );
    const pendingNonce = await rpc.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    const reserved = this.activity
      .filter(
        (item) =>
          item.chainId === network.id &&
          item.from === account.address &&
          item.status === "pending",
      )
      .map((item) => item.nonce + 1);
    const nonce = replacement?.nonce ?? Math.max(pendingNonce, ...reserved);
    let estimate: bigint;
    try {
      estimate = await rpc.estimateGas({ account, to, value: quantity, data });
    } catch {
      throw new UserError(
        "Could not estimate the network fee. Check the recipient and amount, including your token balance, or try again when the network is available.",
      );
    }
    const gas = (estimate * 120n + 99n) / 100n;
    const block = await rpc.getBlock();
    const draft: Draft = {
      public: {
        interpretation: interpret(data, to),
        simulation: {
          status: "unavailable",
          message:
            "Contract execution has not been checked; asset changes are unknown.",
        },
        id: crypto.randomUUID(),
        from: account.address,
        to,
        amount: formatEther(quantity),
        fee: "",
        total: "",
        network: network.name,
        chainId: network.id,
        symbol: network.symbol,
        data,
        expiresAt: Date.now() + 120_000,
        replacement: !!replacement,
      },
      network,
      epoch,
      revision,
      nonce,
      value: quantity,
      gas,
    };
    const bump = (fee: string | undefined) =>
      fee ? (BigInt(fee) * 1125n) / 1000n + 1n : 0n;
    if (block.baseFeePerGas !== null) {
      const fees = await rpc.estimateFeesPerGas();
      draft.maxFee = maxFee(fees.maxFeePerGas, bump(replacement?.maxFee));
      draft.priority = maxFee(
        fees.maxPriorityFeePerGas,
        bump(replacement?.priority),
      );
    } else {
      const fee = await rpc.getGasPrice();
      draft.gasPrice = maxFee(fee, bump(replacement?.gasPrice));
    }
    const fee = gas * (draft.maxFee ?? draft.gasPrice ?? 0n);
    if ((await rpc.getBalance({ address: account.address })) < quantity + fee)
      throw new UserError(
        "Insufficient balance for the amount and maximum network fee.",
      );
    try {
      const simulation = await rpc.call({
        account: account.address,
        to,
        value: quantity,
        data,
      });
      const returnedFalse =
        ["approval", "token-transfer"].includes(
          draft.public.interpretation.kind,
        ) && simulation.data === `0x${"0".repeat(64)}`;
      draft.public.simulation = returnedFalse
        ? {
            status: "unavailable",
            message:
              "Contract returned false. This token operation may fail without reverting.",
          }
        : {
            status: "passed",
            message:
              "RPC eth_call completed at the current state. Asset changes were not independently verified; this does not prove safety.",
          };
    } catch {
      draft.public.simulation = {
        status: "unavailable",
        message:
          "Execution check failed or is unavailable. Asset changes and safety are unknown.",
      };
    }
    draft.public.fee = formatEther(fee);
    draft.public.total = formatEther(quantity + fee);
    if (replacement) draft.replaces = replacement.hash;
    this.vault.assertUnlocked(epoch);
    if (revision !== this.networks.revision)
      throw new UserError("Network changed. Review again.");
    for (const [id, item] of this.drafts)
      if (item.public.expiresAt < Date.now()) this.drafts.delete(id);
    if (this.drafts.size >= 8)
      throw new UserError(
        "Too many pending reviews. Close an old review first.",
      );
    if (generation !== this.generation)
      throw new UserError("Wallet context changed during review. Try again.");
    this.drafts.set(draft.public.id, draft);
    return structuredClone(draft.public);
  }
  cancel(id: string) {
    this.drafts.delete(id);
  }
  async approve(
    idValue: unknown,
    assertRequestActive: () => void = () => {},
  ): Promise<Activity> {
    const id = text(idValue, "review ID", 100);
    const generation = this.generation;
    const draft = this.drafts.get(id);
    this.drafts.delete(id);
    if (!draft || draft.public.expiresAt <= Date.now())
      throw new UserError(
        "This review expired or was already used. Review the transaction again.",
      );
    this.vault.assertUnlocked(draft.epoch);
    const account = this.vault.account();
    if (
      account.address !== draft.public.from ||
      draft.revision !== this.networks.revision
    )
      throw new UserError("Account or network changed. Review again.");
    const assertCurrent = () => {
      this.vault.assertUnlocked(draft.epoch);
      if (draft.public.expiresAt <= Date.now())
        throw new UserError(
          "This review expired. Review the transaction again.",
        );
      if (
        generation !== this.generation ||
        draft.revision !== this.networks.revision
      )
        throw new UserError(
          "Wallet context changed. Review the transaction again.",
        );
      assertRequestActive();
    };
    await verifyChain(draft.network);
    const rpc = client(draft.network);
    const currentNonce = await rpc.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    if (
      !draft.replaces &&
      (currentNonce > draft.nonce ||
        this.activity.some(
          (item) =>
            item.chainId === draft.network.id &&
            item.from === account.address &&
            item.nonce === draft.nonce &&
            ["submitting", "pending", "unknown", "unseen"].includes(
              item.status,
            ),
        ))
    )
      throw new UserError("Nonce changed. Review the transaction again.");
    const base = {
      chainId: draft.network.id,
      nonce: draft.nonce,
      to: draft.public.to,
      value: draft.value,
      gas: draft.gas,
      data: draft.public.data,
    };
    assertCurrent();
    const raw = await account.signTransaction(
      draft.maxFee !== undefined
        ? {
            ...base,
            type: "eip1559",
            maxFeePerGas: draft.maxFee,
            maxPriorityFeePerGas: draft.priority ?? 0n,
          }
        : { ...base, type: "legacy", gasPrice: draft.gasPrice ?? 0n },
    );
    assertCurrent();
    const hash = keccak256(raw);
    let entry: Activity = {
      hash,
      chainId: draft.network.id,
      from: account.address,
      to: draft.public.to,
      value: draft.value.toString(),
      data: draft.public.data,
      nonce: draft.nonce,
      gas: draft.gas.toString(),
      createdAt: Date.now(),
      status: "submitting",
      ...(draft.maxFee !== undefined
        ? {
            maxFee: draft.maxFee.toString(),
            priority: draft.priority?.toString() ?? "0",
          }
        : { gasPrice: draft.gasPrice?.toString() ?? "0" }),
      ...(draft.replaces ? { replaces: draft.replaces } : {}),
    };
    // Persist the known hash before broadcast. A crash cannot make us forget an attempted send.
    await this.save(entry);
    assertCurrent();
    try {
      const returned = await rpc.sendRawTransaction({
        serializedTransaction: raw,
      });
      if (returned !== hash) throw new Error("hash mismatch");
      entry = { ...entry, status: "pending" };
    } catch {
      entry = {
        ...entry,
        status: "unknown",
        error:
          "Submission result uncertain. Refresh activity; do not send again.",
      };
    }
    try {
      await this.save(entry);
    } catch {
      return {
        ...entry,
        status: "unknown",
        error:
          "Submission attempted, but status could not be saved. Check this hash before sending again.",
      };
    }
    return entry;
  }
  async replacement(hashValue: unknown, cancel: boolean) {
    await this.ready;
    const hash = text(hashValue, "transaction hash", 66);
    const original = this.activity.find((item) => item.hash === hash);
    const network = await this.networks.selected();
    if (
      !original ||
      original.chainId !== network.id ||
      original.from !== this.vault.account().address ||
      !["pending", "unknown", "unseen"].includes(original.status)
    )
      throw new UserError("This transaction cannot be replaced.");
    return this.prepare(
      cancel ? original.from : original.to,
      cancel ? "0" : formatEther(BigInt(original.value)),
      cancel ? "0x" : original.data,
      original,
    );
  }
  async refresh() {
    await this.ready;
    const networks = await this.networks.view();
    const next = structuredClone(this.activity);
    const started = Date.now();
    for (const item of next.slice(0, 20)) {
      if (Date.now() - started > 20_000) break;
      if (item.status === "replaced") continue;
      // Continue checking recent confirmations to detect shallow reorganizations.
      if (
        ["confirmed", "reverted"].includes(item.status) &&
        Date.now() - item.createdAt > 3_600_000
      )
        continue;
      const network = networks.items.find(
        (network) => network.id === item.chainId,
      );
      if (!network) continue;
      const rpc = client(network);
      try {
        await verifyChain(network);
      } catch {
        item.error = "RPC chain unavailable or mismatched; status is stale.";
        continue;
      }
      try {
        const receipt = await rpc.getTransactionReceipt({ hash: item.hash });
        item.status = receipt.status === "success" ? "confirmed" : "reverted";
        item.blockHash = receipt.blockHash;
        item.blockNumber = receipt.blockNumber.toString();
        delete item.error;
        if (item.replaces) {
          const old = next.find((old) => old.hash === item.replaces);
          if (old) old.status = "replaced";
        }
      } catch (error) {
        if (!(error instanceof TransactionReceiptNotFoundError)) {
          item.error = "Status unavailable; last known state may be stale.";
          continue;
        }
        delete item.blockHash;
        delete item.blockNumber;
        delete item.error;
        try {
          const tx = await rpc.getTransaction({ hash: item.hash });
          item.status = tx.blockHash ? "unknown" : "pending";
        } catch (error) {
          if (!(error instanceof TransactionNotFoundError)) {
            item.status = "unknown";
            item.error = "Status unavailable; last known state may be stale.";
            continue;
          }
          try {
            const nonce = await rpc.getTransactionCount({ address: item.from });
            item.status =
              nonce > item.nonce
                ? "replaced"
                : Date.now() - item.createdAt > 1_200_000
                  ? "unseen"
                  : "unknown";
          } catch {
            item.error = "Status unavailable; last known state may be stale.";
          }
        }
      }
    }
    await this.persist(next);
    return this.list();
  }
}
