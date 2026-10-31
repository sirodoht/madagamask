import { validateMnemonic } from "@scure/bip39";
import { type Address, getAddress, type Hex, hexToBytes } from "viem";
import {
  english,
  generateMnemonic,
  HDKey,
  hdKeyToAccount,
  mnemonicToAccount,
  privateKeyToAccount,
} from "viem/accounts";
import { integer, record, text, UserError } from "./validation.ts";

export const VAULT_KEY = "vault";
export const SESSION_KEY = "unlockSession";
export const DEFAULT_AUTO_LOCK_MINUTES = 30;
export const KDF_ITERATIONS = 600_000;
const aad = new TextEncoder().encode("madagamask:vault:1");
type Envelope = {
  version: 1;
  iterations: 600000;
  salt: string;
  iv: string;
  ciphertext: string;
};
export type WalletKind = "mnemonic" | "seed" | "privateKey";
type StoredWallet = {
  id: string;
  name: string;
  kind: WalletKind;
  secret: string;
  backedUp: boolean;
};
type Account = { name: string; index: number; walletId: string };
type Payload = {
  version: 2;
  wallets: StoredWallet[];
  accounts: Account[];
  selected: number;
  autoLockMinutes: number;
  autoLockPolicy: 1;
};
export type PublicWallet = Omit<StoredWallet, "secret">;
export type PublicAccount = {
  address: Address;
  name: string;
  walletId: string;
  imported: boolean;
};
export type VaultView = {
  state: "not-created" | "locked" | "unlocked";
  wallets: PublicWallet[];
  accounts: PublicAccount[];
  selected: number;
  backedUp: boolean;
  autoLockMinutes: number;
};
export interface Storage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function decode(
  value: unknown,
  min: number,
  max: number,
): Uint8Array<ArrayBuffer> {
  const encoded = text(value, "vault encoding", max * 2);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new UserError("Invalid vault encoding.");
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  if (bytes.length < min || bytes.length > max)
    throw new UserError("Invalid vault size.");
  return bytes;
}
function envelope(value: unknown): Envelope {
  const data = record(value);
  if (data.version !== 1 || data.iterations !== KDF_ITERATIONS)
    throw new UserError(
      "Unsupported vault format. Existing data has been preserved.",
    );
  decode(data.salt, 32, 32);
  decode(data.iv, 12, 12);
  decode(data.ciphertext, 16, 100_000);
  return data as Envelope;
}
function password(value: unknown): string {
  const result = text(value, "password");
  if (result.length < 12)
    throw new UserError("Use a password of at least 12 characters.");
  return result;
}
function phrase(value: unknown): string {
  const result = text(value, "recovery phrase", 500)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(" ");
  if (!validateMnemonic(result, english))
    throw new UserError("Invalid English BIP39 recovery phrase or checksum.");
  return result;
}
function walletFor(data: Payload, id = data.accounts[data.selected]?.walletId) {
  const wallet = data.wallets.find((item) => item.id === id);
  if (!wallet) throw new UserError("Wallet not found.");
  return wallet;
}
function walletSecret(kind: unknown, value: unknown): string {
  if (kind === "mnemonic") return phrase(value);
  const raw = text(value, kind === "seed" ? "seed" : "private key", 130);
  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`).toLowerCase();
  if (kind === "seed") {
    if (!/^0x(?:[0-9a-f]{2}){16,64}$/.test(hex))
      throw new UserError("Enter a seed of 16–64 bytes in hexadecimal.");
    HDKey.fromMasterSeed(hexToBytes(hex as Hex));
  } else if (kind === "privateKey") {
    if (!/^0x[0-9a-f]{64}$/.test(hex))
      throw new UserError("Enter a 32-byte private key in hexadecimal.");
    try {
      privateKeyToAccount(hex as Hex);
    } catch {
      throw new UserError("Invalid private key.");
    }
  } else throw new UserError("Unsupported wallet type.");
  return hex;
}
function signer(data: Payload, index = data.selected) {
  const account = data.accounts[index];
  if (!account) throw new UserError("Account not found.");
  const wallet = walletFor(data, account.walletId);
  if (wallet.kind === "privateKey")
    return privateKeyToAccount(wallet.secret as Hex);
  if (wallet.kind === "seed")
    return hdKeyToAccount(
      HDKey.fromMasterSeed(hexToBytes(wallet.secret as Hex)),
      { addressIndex: account.index },
    );
  return mnemonicToAccount(wallet.secret, { addressIndex: account.index });
}
function parsePayload(value: unknown): Payload {
  const data = record(value);
  if (
    ![1, 2].includes(data.version as number) ||
    !Array.isArray(data.accounts) ||
    data.accounts.length < 1 ||
    data.accounts.length > 100
  )
    throw new UserError("Invalid or unsupported vault contents.");
  const wallets: StoredWallet[] = [];
  let accounts: Account[];
  if (data.version === 1) {
    if (typeof data.backedUp !== "boolean")
      throw new UserError("Invalid vault contents.");
    wallets.push({
      id: "wallet-1",
      name: "Wallet 1",
      kind: "mnemonic",
      secret: phrase(data.mnemonic),
      backedUp: data.backedUp,
    });
    accounts = data.accounts.map((entry) => {
      const account = record(entry);
      const name = text(account.name, "account name", 60);
      const index = integer(account.index, 0, 99);
      if (account.privateKey === undefined)
        return { name, index, walletId: "wallet-1" };
      const number = wallets.length + 1;
      const walletId = `wallet-${number}`;
      wallets.push({
        id: walletId,
        name: `Wallet ${number}`,
        kind: "privateKey",
        secret: walletSecret("privateKey", account.privateKey),
        backedUp: true,
      });
      return { name, index: 0, walletId };
    });
  } else {
    if (
      !Array.isArray(data.wallets) ||
      !data.wallets.length ||
      data.wallets.length > 100
    )
      throw new UserError("Invalid wallet list.");
    for (const entry of data.wallets) {
      const wallet = record(entry);
      if (typeof wallet.backedUp !== "boolean")
        throw new UserError("Invalid wallet backup state.");
      wallets.push({
        id: text(wallet.id, "wallet ID", 60),
        name: text(wallet.name, "wallet name", 60),
        kind: wallet.kind as WalletKind,
        secret: walletSecret(wallet.kind, wallet.secret),
        backedUp: wallet.backedUp,
      });
    }
    accounts = data.accounts.map((entry) => {
      const account = record(entry);
      return {
        name: text(account.name, "account name", 60),
        index: integer(account.index, 0, 99),
        walletId: text(account.walletId, "wallet ID", 60),
      };
    });
  }
  if (new Set(wallets.map((wallet) => wallet.id)).size !== wallets.length)
    throw new UserError("Duplicate wallet IDs.");
  const seen = new Set<string>();
  for (const account of accounts) {
    const wallet = wallets.find((item) => item.id === account.walletId);
    const key = `${account.walletId}:${account.index}`;
    if (
      !wallet ||
      seen.has(key) ||
      (wallet.kind === "privateKey" && account.index !== 0)
    )
      throw new UserError("Invalid account ownership.");
    seen.add(key);
  }
  for (const wallet of wallets)
    if (!accounts.some((account) => account.walletId === wallet.id))
      throw new UserError("Wallet has no accounts.");
  return {
    version: 2,
    wallets,
    accounts,
    selected: integer(data.selected, 0, accounts.length - 1),
    autoLockMinutes:
      data.autoLockPolicy === undefined && data.autoLockMinutes === 5
        ? DEFAULT_AUTO_LOCK_MINUTES
        : integer(data.autoLockMinutes, 1, 30),
    autoLockPolicy: 1,
  };
}
async function derive(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  extractable = false,
) {
  const bytes = new TextEncoder().encode(secret);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      bytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      extractable,
      ["encrypt", "decrypt"],
    );
  } finally {
    bytes.fill(0);
  }
}
async function encrypt(
  data: Payload,
  key: CryptoKey,
  salt: string,
): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      bytes,
    );
    return {
      version: 1,
      iterations: KDF_ITERATIONS,
      salt,
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(ciphertext)),
    };
  } finally {
    bytes.fill(0);
  }
}

// Mutating calls are serialized by the background. lock() is immediate and
// invalidates in-flight crypto operations via an epoch, including slow unlocks.
export class Vault {
  private session: { data: Payload; key: CryptoKey; salt: string } | undefined;
  private epoch = 0;
  private lastActivity = 0;
  private readonly storage: Storage;
  private readonly now: () => number;
  private readonly sessionStorage: Storage | undefined;
  private sessionWrites: Promise<void> = Promise.resolve();
  constructor(storage: Storage, now = Date.now, sessionStorage?: Storage) {
    this.storage = storage;
    this.now = now;
    this.sessionStorage = sessionStorage;
  }

  lock() {
    this.session = undefined;
    this.epoch += 1;
    this.persistSession();
  }
  // Serialize session writes with deletion. A completed Lock cannot be undone by
  // an earlier export/write finishing late. Session failures fail closed.
  private persistSession() {
    const store = this.sessionStorage;
    if (!store) return;
    const write = this.sessionWrites
      .catch(() => {})
      .then(async () => {
        try {
          const session = this.session;
          const epoch = this.epoch;
          if (!session) return await store.remove(SESSION_KEY);
          const lastActivity = this.lastActivity;
          const expiresAt =
            lastActivity + session.data.autoLockMinutes * 60_000;
          const bytes = new Uint8Array(
            await crypto.subtle.exportKey("raw", session.key),
          );
          try {
            if (
              epoch !== this.epoch ||
              this.now() >= expiresAt ||
              this.now() < lastActivity
            ) {
              if (epoch === this.epoch) {
                this.session = undefined;
                this.epoch += 1;
              }
              await store.remove(SESSION_KEY);
              return;
            }
            await store.set(SESSION_KEY, {
              version: 1,
              key: encode(bytes),
              salt: session.salt,
              lastActivity,
              expiresAt,
            });
          } finally {
            bytes.fill(0);
          }
        } catch {
          this.session = undefined;
          this.epoch += 1;
          // Try both operations: some storage failures affect only one method.
          try {
            await store.remove(SESSION_KEY);
          } catch {
            await store.set(SESSION_KEY, null);
          }
          throw new UserError(
            "Could not save the unlock session. Unlock the wallet again.",
          );
        }
      });
    this.sessionWrites = write;
    void write.catch(() => {});
  }
  async flushSession() {
    await this.sessionWrites;
  }
  async restoreSession() {
    const store = this.sessionStorage;
    if (!store) return;
    const epoch = this.epoch;
    try {
      const value = await store.get(SESSION_KEY);
      if (value === undefined || value === null) return;
      const saved = record(value);
      const lastActivity = integer(
        saved.lastActivity,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const expiresAt = integer(saved.expiresAt, 0, Number.MAX_SAFE_INTEGER);
      if (
        saved.version !== 1 ||
        this.now() < lastActivity ||
        this.now() >= expiresAt
      )
        throw new Error("Expired session");
      const encrypted = envelope(await this.storage.get(VAULT_KEY));
      if (saved.salt !== encrypted.salt) throw new Error("Different vault");
      const bytes = decode(saved.key, 32, 32);
      let key: CryptoKey;
      try {
        key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", true, [
          "encrypt",
          "decrypt",
        ]);
      } finally {
        bytes.fill(0);
      }
      const session = await this.decryptWithKey(encrypted, key);
      if (
        expiresAt !== lastActivity + session.data.autoLockMinutes * 60_000 ||
        this.now() >= expiresAt ||
        this.now() < lastActivity
      )
        throw new Error("Invalid session deadline");
      this.assertEpoch(epoch);
      this.session = session;
      this.lastActivity = lastActivity;
    } catch {
      if (epoch === this.epoch) this.lock();
      await this.flushSession();
    }
  }
  expire() {
    if (
      this.session &&
      (this.now() < this.lastActivity ||
        this.now() - this.lastActivity >=
          this.session.data.autoLockMinutes * 60_000)
    )
      this.lock();
  }
  touch() {
    this.expire();
    if (this.session) {
      this.lastActivity = this.now();
      this.persistSession();
    }
  }
  private current() {
    this.expire();
    if (!this.session) throw new UserError("Unlock your wallet first.");
    return this.session;
  }
  private assertEpoch(epoch: number) {
    if (epoch !== this.epoch)
      throw new UserError(
        "Wallet locked during this operation. Please try again.",
      );
  }

  async view(): Promise<VaultView> {
    this.expire();
    const data = this.session?.data;
    return {
      state: data
        ? "unlocked"
        : (await this.storage.get(VAULT_KEY))
          ? "locked"
          : "not-created",
      accounts: data
        ? data.accounts.map((account, index) => ({
            name: account.name,
            address: getAddress(signer(data, index).address),
            walletId: account.walletId,
            imported: walletFor(data, account.walletId).kind === "privateKey",
          }))
        : [],
      wallets: data
        ? data.wallets.map(({ id, name, kind, backedUp }) => ({
            id,
            name,
            kind,
            backedUp,
          }))
        : [],
      selected: data?.selected ?? 0,
      backedUp: data ? walletFor(data).backedUp : false,
      autoLockMinutes: data?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
    };
  }
  async create(
    secret: unknown,
    recovery?: unknown,
    kind: unknown = "mnemonic",
  ) {
    const epoch = this.epoch;
    if (await this.storage.get(VAULT_KEY))
      throw new UserError(
        "A wallet already exists. Use Add wallet to import another.",
      );
    const material = walletSecret(
      kind,
      recovery === undefined && kind === "mnemonic"
        ? generateMnemonic(english, 128)
        : recovery,
    );
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await derive(password(secret), salt, !!this.sessionStorage);
    const data: Payload = {
      version: 2,
      wallets: [
        {
          id: "wallet-1",
          name: "Wallet 1",
          kind: kind as WalletKind,
          secret: material,
          backedUp: recovery !== undefined,
        },
      ],
      accounts: [{ name: "Account 1", index: 0, walletId: "wallet-1" }],
      selected: 0,
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      autoLockPolicy: 1,
    };
    const encrypted = await encrypt(data, key, encode(salt));
    this.assertEpoch(epoch);
    await this.storage.set(VAULT_KEY, encrypted);
    this.assertEpoch(epoch);
    this.session = { data, key, salt: encrypted.salt };
    this.lastActivity = this.now();
    this.persistSession();
    await this.flushSession();
  }
  private async decrypt(secret: unknown) {
    const encrypted = envelope(await this.storage.get(VAULT_KEY));
    const key = await derive(
      password(secret),
      decode(encrypted.salt, 32, 32),
      !!this.sessionStorage,
    );
    return this.decryptWithKey(encrypted, key);
  }
  private async decryptWithKey(encrypted: Envelope, key: CryptoKey) {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decode(encrypted.iv, 12, 12),
            additionalData: aad,
          },
          key,
          decode(encrypted.ciphertext, 16, 100_000),
        ),
      );
    } catch {
      throw new UserError("Incorrect password or damaged vault.");
    }
    try {
      return {
        key,
        salt: encrypted.salt,
        data: parsePayload(JSON.parse(new TextDecoder().decode(bytes))),
      };
    } finally {
      bytes.fill(0);
    }
  }
  async unlock(secret: unknown) {
    const epoch = this.epoch;
    const session = await this.decrypt(secret);
    this.assertEpoch(epoch);
    this.session = session;
    this.lastActivity = this.now();
    this.persistSession();
    await this.flushSession();
  }
  async reveal(secret: unknown, importedIndex?: unknown, walletId?: unknown) {
    const epoch = this.epoch;
    this.current();
    const session = await this.decrypt(secret);
    this.assertEpoch(epoch);
    this.current();
    if (importedIndex !== undefined) {
      const account =
        session.data.accounts[
          integer(importedIndex, 0, session.data.accounts.length - 1)
        ];
      const wallet = walletFor(session.data, account?.walletId);
      if (wallet.kind !== "privateKey")
        throw new UserError("This account is backed up by its wallet.");
      return wallet.secret;
    }
    // Legacy callers without an explicit wallet retain the original phrase backup.
    return walletFor(
      session.data,
      walletId === undefined
        ? session.data.wallets[0]?.id
        : text(walletId, "wallet ID", 60),
    ).secret;
  }
  private async save(data: Payload) {
    const epoch = this.epoch;
    const session = this.current();
    const encrypted = await encrypt(data, session.key, session.salt);
    this.assertEpoch(epoch);
    await this.storage.set(VAULT_KEY, encrypted);
    this.assertEpoch(epoch);
    this.current();
    this.session = { ...session, data };
    this.persistSession();
    await this.flushSession();
  }
  async confirmBackup(value: unknown, walletId?: unknown) {
    const { data } = this.current();
    const wallet = walletFor(
      data,
      walletId === undefined ? undefined : text(walletId, "wallet ID", 60),
    );
    if (walletSecret(wallet.kind, value) !== wallet.secret)
      throw new UserError("The backup does not match this wallet.");
    await this.save({
      ...data,
      wallets: data.wallets.map((item) =>
        item.id === wallet.id ? { ...item, backedUp: true } : item,
      ),
    });
  }
  async addWallet(name: unknown, kind: unknown, value?: unknown) {
    const { data } = this.current();
    if (data.accounts.length >= 100 || data.wallets.length >= 100)
      throw new UserError("Account limit reached.");
    const generated = kind === "mnemonic" && value === undefined;
    const secret = walletSecret(
      kind,
      generated ? generateMnemonic(english, 128) : value,
    );
    const wallet: StoredWallet = {
      id: crypto.randomUUID(),
      name: text(name, "wallet name", 60),
      kind: kind as WalletKind,
      secret,
      backedUp: !generated,
    };
    const next: Payload = {
      ...data,
      wallets: [...data.wallets, wallet],
      accounts: [
        ...data.accounts,
        { name: "Account 1", index: 0, walletId: wallet.id },
      ],
      selected: data.accounts.length,
    };
    this.assertNewAddress(next, data);
    await this.save(next);
  }
  private assertNewAddress(next: Payload, previous: Payload) {
    const address = signer(next).address;
    if (
      previous.accounts.some(
        (_, index) => signer(previous, index).address === address,
      )
    )
      throw new UserError("This account already exists.");
  }
  async addAccount(name: unknown, key?: unknown, walletId?: unknown) {
    const { data } = this.current();
    if (data.accounts.length >= 100)
      throw new UserError("Account limit reached.");
    if (key !== undefined) {
      // Preserve the existing import command while representing its key as a wallet.
      const wallet: StoredWallet = {
        id: crypto.randomUUID(),
        name: `Wallet ${data.wallets.length + 1}`,
        kind: "privateKey",
        secret: walletSecret("privateKey", key),
        backedUp: true,
      };
      const next: Payload = {
        ...data,
        wallets: [...data.wallets, wallet],
        accounts: [
          ...data.accounts,
          {
            name: text(name, "account name", 60),
            index: 0,
            walletId: wallet.id,
          },
        ],
        selected: data.accounts.length,
      };
      this.assertNewAddress(next, data);
      await this.save(next);
      return;
    }
    const wallet = walletFor(
      data,
      walletId === undefined ? undefined : text(walletId, "wallet ID", 60),
    );
    if (wallet.kind === "privateKey")
      throw new UserError("This wallet contains one account.");
    const index =
      Math.max(
        ...data.accounts
          .filter((item) => item.walletId === wallet.id)
          .map((item) => item.index),
      ) + 1;
    if (index > 99) throw new UserError("Account limit reached.");
    const next: Payload = {
      ...data,
      accounts: [
        ...data.accounts,
        { name: text(name, "account name", 60), index, walletId: wallet.id },
      ],
      selected: data.accounts.length,
    };
    this.assertNewAddress(next, data);
    await this.save(next);
  }
  async renameWallet(walletId: unknown, name: unknown) {
    const { data } = this.current();
    const wallet = walletFor(data, text(walletId, "wallet ID", 60));
    const nextName = text(name, "wallet name", 60);
    await this.save({
      ...data,
      wallets: data.wallets.map((item) =>
        item.id === wallet.id ? { ...item, name: nextName } : item,
      ),
    });
  }
  async select(index: unknown) {
    const { data } = this.current();
    await this.save({
      ...data,
      selected: integer(index, 0, data.accounts.length - 1),
    });
  }
  async rename(name: unknown, accountIndex?: unknown) {
    const { data } = this.current();
    const target =
      accountIndex === undefined
        ? data.selected
        : integer(accountIndex, 0, data.accounts.length - 1);
    await this.save({
      ...data,
      accounts: data.accounts.map((account, index) =>
        index === target
          ? { ...account, name: text(name, "account name", 60) }
          : account,
      ),
    });
  }
  async autoLock(minutes: unknown) {
    const { data } = this.current();
    await this.save({ ...data, autoLockMinutes: integer(minutes, 1, 30) });
  }
  async changePassword(oldSecret: unknown, newSecret: unknown) {
    const epoch = this.epoch;
    this.current();
    const { data } = await this.decrypt(oldSecret);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await derive(password(newSecret), salt, !!this.sessionStorage);
    const encrypted = await encrypt(data, key, encode(salt));
    this.assertEpoch(epoch);
    this.current();
    await this.storage.set(VAULT_KEY, encrypted);
    this.assertEpoch(epoch);
    this.session = { data, key, salt: encrypted.salt };
    this.persistSession();
    await this.flushSession();
  }
  async reset(
    secret: unknown,
    confirmation: unknown,
    beforeDelete: () => Promise<void> = async () => {},
  ) {
    if (confirmation !== "DELETE")
      throw new UserError("Type DELETE to reset this wallet.");
    const epoch = this.epoch;
    await this.decrypt(secret);
    this.assertEpoch(epoch);
    await beforeDelete();
    this.assertEpoch(epoch);
    await this.storage.remove(VAULT_KEY);
    this.lock();
  }
  account() {
    const { data } = this.current();
    if (!walletFor(data).backedUp)
      throw new UserError("Back up and confirm this wallet first.");
    return signer(data);
  }
  generation() {
    this.expire();
    return this.epoch;
  }
  assertUnlocked(epoch: number) {
    this.assertEpoch(epoch);
    this.current();
  }
}
