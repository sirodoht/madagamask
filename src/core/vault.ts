import { validateMnemonic } from "@scure/bip39";
import { type Address, getAddress, type Hex } from "viem";
import {
  english,
  generateMnemonic,
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
type Account = { name: string; index: number; privateKey?: Hex };
type Payload = {
  version: 1;
  mnemonic: string;
  accounts: Account[];
  selected: number;
  backedUp: boolean;
  autoLockMinutes: number;
  autoLockPolicy: 1;
};
export type PublicAccount = {
  address: Address;
  name: string;
  imported: boolean;
};
export type VaultView = {
  state: "not-created" | "locked" | "unlocked";
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
function signer(data: Payload, index = data.selected) {
  const account = data.accounts[index];
  if (!account) throw new UserError("Account not found.");
  return account.privateKey
    ? privateKeyToAccount(account.privateKey)
    : mnemonicToAccount(data.mnemonic, { addressIndex: account.index });
}
function parsePayload(value: unknown): Payload {
  const data = record(value);
  if (
    data.version !== 1 ||
    !Array.isArray(data.accounts) ||
    data.accounts.length < 1 ||
    data.accounts.length > 100 ||
    typeof data.backedUp !== "boolean"
  )
    throw new UserError("Invalid vault contents.");
  const accounts = data.accounts.map((entry) => {
    const account = record(entry);
    const result: Account = {
      name: text(account.name, "account name", 60),
      index: integer(account.index, 0, 99),
    };
    if (account.privateKey !== undefined) {
      result.privateKey = text(account.privateKey, "private key", 66) as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(result.privateKey))
        throw new UserError("Invalid private key.");
      privateKeyToAccount(result.privateKey);
    }
    return result;
  });
  return {
    version: 1,
    mnemonic: phrase(data.mnemonic),
    accounts,
    selected: integer(data.selected, 0, accounts.length - 1),
    backedUp: data.backedUp,
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
            imported: !!account.privateKey,
          }))
        : [],
      selected: data?.selected ?? 0,
      backedUp: data?.backedUp ?? false,
      autoLockMinutes: data?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
    };
  }
  async create(secret: unknown, recovery?: unknown) {
    const epoch = this.epoch;
    if (await this.storage.get(VAULT_KEY))
      throw new UserError(
        "A wallet already exists. Reset it before importing another.",
      );
    const mnemonic =
      recovery === undefined
        ? generateMnemonic(english, 128)
        : phrase(recovery);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await derive(password(secret), salt, !!this.sessionStorage);
    const data: Payload = {
      version: 1,
      mnemonic,
      accounts: [{ name: "Account 1", index: 0 }],
      selected: 0,
      backedUp: recovery !== undefined,
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
  async reveal(secret: unknown, importedIndex?: unknown) {
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
      if (!account?.privateKey)
        throw new UserError(
          "This account is backed up by your recovery phrase.",
        );
      return account.privateKey;
    }
    return session.data.mnemonic;
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
  async confirmBackup(value: unknown) {
    const { data } = this.current();
    if (phrase(value) !== data.mnemonic)
      throw new UserError("The recovery phrase does not match.");
    await this.save({ ...data, backedUp: true });
  }
  async addAccount(name: unknown, key?: unknown) {
    const { data } = this.current();
    if (data.accounts.length >= 100)
      throw new UserError("Account limit reached.");
    const account: Account = {
      name: text(name, "account name", 60),
      index: data.accounts.filter((item) => !item.privateKey).length,
    };
    if (key !== undefined) {
      const value = text(key, "private key", 66);
      if (!/^0x[0-9a-fA-F]{64}$/.test(value))
        throw new UserError("Enter a 0x-prefixed 32-byte private key.");
      try {
        privateKeyToAccount(value as Hex);
      } catch {
        throw new UserError("Invalid private key.");
      }
      account.privateKey = value as Hex;
    }
    const next = {
      ...data,
      accounts: [...data.accounts, account],
      selected: data.accounts.length,
    };
    const address = signer(next).address;
    if (
      data.accounts.some((_, index) => signer(data, index).address === address)
    )
      throw new UserError("This account already exists.");
    await this.save(next);
  }
  async select(index: unknown) {
    const { data } = this.current();
    await this.save({
      ...data,
      selected: integer(index, 0, data.accounts.length - 1),
    });
  }
  async rename(name: unknown) {
    const { data } = this.current();
    await this.save({
      ...data,
      accounts: data.accounts.map((account, index) =>
        index === data.selected
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
    if (!data.backedUp)
      throw new UserError("Back up and confirm your recovery phrase first.");
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
