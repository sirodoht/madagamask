import {
  formatEther,
  type Hex,
  hashTypedData,
  type TypedDataDefinition,
} from "viem";
import { rpc, SIGNING_CHAINS } from "./networks.ts";
import type { Protection } from "./phishing.ts";
import { reducePermission, validateSigningFields } from "./signing.ts";
import { editAllowance } from "./tokens.ts";
import { address, hexData, type Preview } from "./transactions.ts";
import { record, text, UserError } from "./validation.ts";
import type { Storage } from "./vault.ts";
import type { Wallet } from "./wallet.ts";

export class ProviderError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
export type Site = { origin: string; tabId: number; documentId: string };
export type Approval = {
  protection: Protection;
  id: string;
  origin: string;
  method: string;
  params: unknown[];
  account: string;
  chainId: number;
  expiresAt: number;
  preview?: Preview;
};
type Pending = {
  cancelled?: boolean;
  view: Approval;
  site: Site;
  epoch: number;
  revision: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const READ_METHODS = new Set([
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_gasPrice",
  "eth_feeHistory",
]);
const APPROVAL_METHODS = new Set([
  "eth_requestAccounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);
function chainId(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw new ProviderError(-32602, "Invalid hexadecimal chain ID.");
  return Number(value);
}
function typedData(value: unknown, selectedChain: number): TypedDataDefinition {
  const data = record(typeof value === "string" ? JSON.parse(value) : value);
  const domain = record(data.domain);
  const types = record(data.types);
  text(data.primaryType, "primary type", 100);
  record(data.message);
  if (domain.chainId !== undefined && Number(domain.chainId) !== selectedChain)
    throw new ProviderError(4901, "Typed data targets another chain.");
  if (Object.keys(types).length > 50)
    throw new ProviderError(-32602, "Too many typed-data types.");
  for (const fields of Object.values(types)) {
    if (!Array.isArray(fields) || fields.length > 50)
      throw new ProviderError(-32602, "Invalid typed-data fields.");
    for (const field of fields) {
      const item = record(field);
      text(item.name, "field name", 100);
      text(item.type, "field type", 100);
    }
  }
  validateSigningFields(data);
  const result = data as unknown as TypedDataDefinition;
  hashTypedData(result);
  return result;
}
export class Dapps {
  private wallet: Wallet;
  private storage: Storage;
  private grants: Record<string, string[]> = {};
  private ready: Promise<void>;
  private pending = new Map<string, Pending>();
  private active = new Map<string, Pending>();
  private permissionQueue: Promise<unknown> = Promise.resolve();
  private inflight = new Set<string>();
  isSiteActive: (site: Site) => boolean = () => true;
  onRequest: (site: Site) => Promise<void> = async () => {};
  constructor(wallet: Wallet, storage: Storage) {
    this.wallet = wallet;
    this.storage = storage;
    this.ready = this.load();
  }
  private async load() {
    const saved = await this.storage.get("permissions");
    if (saved === undefined) return;
    const data = record(saved);
    if (data.version !== 1)
      throw new UserError("Unsupported permission format.");
    const grants = record(data.grants);
    for (const [origin, values] of Object.entries(grants)) {
      if (
        new URL(origin).origin !== origin ||
        !Array.isArray(values) ||
        values.length > 100
      )
        throw new UserError("Invalid permission data.");
      this.grants[origin] = values.map(address);
    }
  }
  private changeGrants(
    change: (current: Record<string, string[]>) => Record<string, string[]>,
  ) {
    const job = this.permissionQueue.then(async () => {
      await this.ready;
      const next = change(this.grants);
      if (Object.keys(next).length > 1000)
        throw new UserError(
          "Too many connected sites. Disconnect an old site first.",
        );
      await this.storage.set("permissions", { version: 1, grants: next });
      this.grants = next;
    });
    this.permissionQueue = job.catch(() => {});
    return job;
  }
  async connections() {
    await this.ready;
    return structuredClone(this.grants);
  }
  approvals() {
    return [...this.pending.values()].map((item) => structuredClone(item.view));
  }
  async accounts(origin: string) {
    await this.ready;
    const vault = await this.wallet.vault.view();
    if (vault.state !== "unlocked") return [];
    const selected = vault.accounts[vault.selected]?.address;
    return selected && this.grants[origin]?.includes(selected)
      ? [selected]
      : [];
  }
  invalidate(
    message = "Wallet context changed. Request rejected.",
    except?: string,
  ) {
    for (const id of [...this.pending.keys(), ...this.active.keys()])
      if (id !== except) this.reject(id, message);
  }
  rejectTab(tabId: number) {
    for (const [id, item] of [...this.pending, ...this.active])
      if (item.site.tabId === tabId)
        this.reject(id, "Requesting tab closed or navigated.");
  }
  reject(id: string, message = "User rejected the request.") {
    const pending = this.pending.get(id) ?? this.active.get(id);
    if (!pending) return;
    pending.cancelled = true;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.view.preview)
      this.wallet.transactions.cancel(pending.view.preview.id);
    pending.reject(new ProviderError(4001, message));
  }
  async revoke(origin: string) {
    await this.ready;
    await this.changeGrants((current) => {
      const next = { ...current };
      delete next[origin];
      return next;
    });
    for (const [id, item] of [...this.pending, ...this.active])
      if (item.view.origin === origin) this.reject(id, "Connection revoked.");
  }
  async clear() {
    this.invalidate();
    await this.changeGrants(() => ({}));
  }
  async request(input: unknown, site: Site): Promise<unknown> {
    await this.ready;
    const payload = record(input);
    const method = text(payload.method, "method", 80);
    const params = payload.params === undefined ? [] : payload.params;
    if (!Array.isArray(params) || JSON.stringify(params).length > 24_000)
      throw new ProviderError(-32602, "Invalid request parameters.");
    const protection = await this.wallet.phishing.check(site.origin);
    const network = await this.wallet.networks.selected();
    if (method === "eth_chainId") return `0x${network.id.toString(16)}`;
    if (method === "net_version") return String(network.id);
    if (method === "eth_accounts") return this.accounts(site.origin);
    if (method === "wallet_getPermissions")
      return (await this.accounts(site.origin)).length
        ? [{ parentCapability: "eth_accounts" }]
        : [];
    if (method === "wallet_revokePermissions") {
      await this.revoke(site.origin);
      return null;
    }
    if (!READ_METHODS.has(method) && !APPROVAL_METHODS.has(method))
      throw new ProviderError(4200, "This method is not supported.");
    const accounts = await this.accounts(site.origin);
    if (method !== "eth_requestAccounts" && !accounts.length)
      throw new ProviderError(
        4100,
        "Connect this site to the selected account first.",
      );
    if (READ_METHODS.has(method)) return rpc(network, method, params);
    const vault = await this.wallet.vault.view();
    const account = vault.accounts[vault.selected];
    if (!account)
      throw new ProviderError(4100, "Unlock your wallet, then request again.");
    if (
      this.pending.size + this.active.size + this.inflight.size >= 8 ||
      this.inflight.has(site.origin) ||
      [...this.pending.values(), ...this.active.values()].some(
        (item) => item.view.origin === site.origin,
      )
    )
      throw new ProviderError(
        -32002,
        "A request is already pending. Review it in the wallet.",
      );
    this.inflight.add(site.origin);
    try {
      const epoch = this.wallet.vault.generation();
      const revision = this.wallet.networks.revision;
      let preview: Preview | undefined;
      if (method === "eth_sendTransaction") {
        if (params.length !== 1)
          throw new ProviderError(-32602, "Expected one transaction.");
        const tx = record(params[0]);
        if (
          Object.keys(tx).some(
            (key) => !["from", "to", "value", "data", "chainId"].includes(key),
          )
        )
          throw new ProviderError(
            -32602,
            "This alpha estimates fees and nonce itself. Supply only from, to, value, data, and optional chainId.",
          );
        if (address(tx.from) !== account.address)
          throw new ProviderError(4100, "Transaction account does not match.");
        if (tx.chainId !== undefined && chainId(tx.chainId) !== network.id)
          throw new ProviderError(4901, "Transaction chain does not match.");
        const value =
          tx.value === undefined ? "0x0" : text(tx.value, "value", 66);
        if (!/^0x[0-9a-fA-F]+$/.test(value))
          throw new ProviderError(-32602, "Value must be hexadecimal wei.");
        preview = await this.wallet.transactions.prepare(
          tx.to,
          formatEther(BigInt(value)),
          tx.data,
        );
      } else if (method === "personal_sign") {
        if (params.length !== 2 || address(params[1]) !== account.address)
          throw new ProviderError(4100, "Signature account does not match.");
        hexData(params[0]);
        if (!SIGNING_CHAINS.has(network.id))
          throw new ProviderError(
            4901,
            "Signing is not supported on this network.",
          );
      } else if (method === "eth_signTypedData_v4") {
        if (params.length !== 2 || address(params[0]) !== account.address)
          throw new ProviderError(4100, "Signature account does not match.");
        typedData(params[1], network.id);
        if (!SIGNING_CHAINS.has(network.id))
          throw new ProviderError(
            4901,
            "Signing is not supported on this network.",
          );
      } else if (method === "wallet_switchEthereumChain") {
        if (params.length !== 1)
          throw new ProviderError(-32602, "Expected one network.");
        chainId(record(params[0]).chainId);
      } else if (method === "wallet_addEthereumChain") {
        if (params.length !== 1)
          throw new ProviderError(-32602, "Expected one network.");
        const value = record(params[0]);
        chainId(value.chainId);
        text(value.chainName, "network name", 60);
        const currency = record(value.nativeCurrency);
        if (
          currency.decimals !== 18 ||
          !Array.isArray(value.rpcUrls) ||
          value.rpcUrls.length !== 1
        )
          throw new ProviderError(
            -32602,
            "Provide one RPC URL and an 18-decimal currency.",
          );
      } else if (params.length)
        throw new ProviderError(-32602, "This method takes no parameters.");
      this.wallet.vault.assertUnlocked(epoch);
      if (revision !== this.wallet.networks.revision)
        throw new ProviderError(4001, "Network changed during request.");
      if (!this.isSiteActive(site))
        throw new ProviderError(4001, "Requesting page is no longer active.");
      const view: Approval = {
        protection,
        id: crypto.randomUUID(),
        origin: site.origin,
        method,
        params: structuredClone(params),
        account: account.address,
        chainId: network.id,
        expiresAt: Date.now() + 120_000,
        ...(preview ? { preview } : {}),
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => this.reject(view.id, "Request expired."),
          120_000,
        );
        this.pending.set(view.id, {
          view,
          site,
          epoch,
          revision,
          resolve,
          reject,
          timer,
        });
        void this.onRequest(site).catch(() =>
          this.reject(view.id, "Approval window could not be opened."),
        );
      });
    } finally {
      this.inflight.delete(site.origin);
    }
  }
  async editAllowance(idValue: unknown, amount: unknown) {
    const id = text(idValue, "approval ID", 100);
    const pending = this.pending.get(id);
    if (!pending || pending.view.expiresAt <= Date.now())
      throw new UserError("Transaction review not found.");
    if (pending.view.method === "eth_signTypedData_v4") {
      const next = reducePermission(pending.view.params[1], amount);
      typedData(next, pending.view.chainId);
      pending.view.params = [pending.view.account, next];
      this.renewReview(id, pending);
      return;
    }
    if (!pending.view.preview)
      throw new UserError("Transaction review not found.");
    const old = pending.view.preview;
    const data = editAllowance(old.data, amount);
    const preview = await this.wallet.transactions.prepare(
      old.to,
      old.amount,
      data,
    );
    if (!this.pending.has(id)) {
      this.wallet.transactions.cancel(preview.id);
      throw new UserError("Request was dismissed.");
    }
    this.wallet.transactions.cancel(old.id);
    pending.view.preview = preview;
    const tx = record(pending.view.params[0]);
    pending.view.params = [{ ...tx, data }];
    this.renewReview(id, pending);
  }
  private renewReview(id: string, pending: Pending) {
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.view.id = crypto.randomUUID();
    pending.timer = setTimeout(
      () => this.reject(pending.view.id, "Request expired."),
      Math.max(0, pending.view.expiresAt - Date.now()),
    );
    this.pending.set(pending.view.id, pending);
  }
  async approve(idValue: unknown) {
    const id = text(idValue, "approval ID", 100);
    const pending = this.pending.get(id);
    if (!pending) throw new UserError("Request expired or was dismissed.");
    this.pending.delete(id);
    this.active.set(id, pending);
    clearTimeout(pending.timer);
    const assertActive = () => {
      if (
        pending.cancelled ||
        !this.isSiteActive(pending.site) ||
        pending.view.expiresAt < Date.now()
      )
        throw new ProviderError(
          4001,
          "Request was dismissed or is no longer active.",
        );
    };
    try {
      const { view } = pending;
      await this.wallet.phishing.check(view.origin);
      assertActive();
      if (!this.isSiteActive(pending.site))
        throw new ProviderError(4001, "Requesting page is no longer active.");
      this.wallet.vault.assertUnlocked(pending.epoch);
      const vault = await this.wallet.vault.view();
      if (
        view.expiresAt < Date.now() ||
        pending.revision !== this.wallet.networks.revision ||
        vault.accounts[vault.selected]?.address !== view.account
      )
        throw new ProviderError(4001, "Account or network changed.");
      let result: unknown = null;
      if (view.method === "eth_requestAccounts") {
        await this.changeGrants((current) => {
          assertActive();
          return { ...current, [view.origin]: [view.account] };
        });
        this.wallet.vault.assertUnlocked(pending.epoch);
        result = [view.account];
      } else {
        if (!(await this.accounts(view.origin)).includes(view.account))
          throw new ProviderError(4100, "Permission was revoked.");
        if (view.method === "eth_sendTransaction") {
          if (!view.preview) throw new UserError("Missing transaction review.");
          result = (
            await this.wallet.transactions.approve(
              view.preview.id,
              assertActive,
            )
          ).hash;
        } else if (view.method === "personal_sign")
          result = await this.wallet.vault
            .account()
            .signMessage({ message: { raw: view.params[0] as Hex } });
        else if (view.method === "eth_signTypedData_v4")
          result = await this.wallet.vault
            .account()
            .signTypedData(typedData(view.params[1], view.chainId));
        else if (view.method === "wallet_switchEthereumChain") {
          await this.wallet.networks.select(
            chainId(record(view.params[0]).chainId),
          );
          this.invalidate(undefined, id);
          this.wallet.transactions.invalidate();
        } else if (view.method === "wallet_addEthereumChain") {
          const data = record(view.params[0]);
          const currency = record(data.nativeCurrency);
          await this.wallet.networks.add({
            id: chainId(data.chainId),
            name: data.chainName,
            rpc: (data.rpcUrls as unknown[])[0],
            symbol: currency.symbol,
          });
          this.invalidate(undefined, id);
          this.wallet.transactions.invalidate();
        }
      }
      this.wallet.vault.assertUnlocked(pending.epoch);
      if (
        !["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(
          view.method,
        )
      )
        assertActive();
      pending.resolve(result);
    } catch (error) {
      pending.reject(
        error instanceof ProviderError
          ? error
          : new ProviderError(
              4001,
              error instanceof UserError ? error.message : "Approval failed.",
            ),
      );
      throw error;
    } finally {
      this.active.delete(id);
    }
  }
}
