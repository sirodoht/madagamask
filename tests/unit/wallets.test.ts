import assert from "node:assert/strict";
import { test } from "node:test";
import { mnemonicToSeedSync } from "@scure/bip39";
import { bytesToHex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { KDF_ITERATIONS, type Storage, Vault } from "../../src/core/vault.ts";

const phrase = "test test test test test test test test test test test junk";
const otherPhrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const password = "disposable-wallets-password";
const key = `0x${"11".repeat(32)}` as const;
function memory() {
  const data = new Map<string, unknown>();
  let failing = false;
  const storage: Storage = {
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => {
      if (failing) throw new Error("write failed");
      data.set(key, structuredClone(value));
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return {
    data,
    storage,
    fail: (value: boolean) => {
      failing = value;
    },
  };
}
async function fixture(contents: unknown) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: KDF_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("madagamask:vault:1"),
    },
    key,
    new TextEncoder().encode(JSON.stringify(contents)),
  );
  const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  return {
    version: 1,
    iterations: KDF_ITERATIONS,
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  };
}

test("legacy vault migration preserves interleaved accounts, selection, secrets and failed-write recovery", async () => {
  const store = memory();
  const legacy = await fixture({
    version: 1,
    mnemonic: phrase,
    backedUp: false,
    accounts: [
      { name: "First", index: 0 },
      { name: "gox", index: 0, privateKey: key },
      { name: "aria", index: 1 },
    ],
    selected: 1,
    autoLockMinutes: 5,
  });
  store.data.set("vault", legacy);
  const vault = new Vault(store.storage);
  await vault.unlock(password);
  const view = await vault.view();
  assert.equal(view.selected, 1);
  assert.deepEqual(
    view.accounts.map((a) => a.name),
    ["First", "gox", "aria"],
  );
  assert.deepEqual(
    view.accounts.map((a) => a.address),
    [
      mnemonicToAccount(phrase).address,
      privateKeyToAccount(key).address,
      mnemonicToAccount(phrase, { addressIndex: 1 }).address,
    ],
  );
  assert.deepEqual(
    view.wallets.map((w) => w.kind),
    ["mnemonic", "privateKey"],
  );
  assert.equal(view.accounts[0]?.walletId, view.accounts[2]?.walletId);
  assert.notEqual(view.accounts[0]?.walletId, view.accounts[1]?.walletId);
  assert.equal(view.autoLockMinutes, 30);
  assert.equal(vault.account().address, privateKeyToAccount(key).address);
  assert.deepEqual(store.data.get("vault"), legacy);
  store.fail(true);
  await assert.rejects(
    vault.renameWallet("wallet-1", "Personal"),
    /write failed/,
  );
  assert.deepEqual(store.data.get("vault"), legacy);
  store.fail(false);
  await vault.renameWallet("wallet-1", "Personal");
  const migrated = new Vault(store.storage);
  await migrated.unlock(password);
  assert.deepEqual((await migrated.view()).accounts, view.accounts);
  assert.equal((await migrated.view()).selected, 1);
  assert.equal((await migrated.view()).wallets[0]?.name, "Personal");
  assert.equal(await migrated.reveal(password, undefined, "wallet-1"), phrase);
  assert.equal(await migrated.reveal(password, undefined, "wallet-2"), key);
});

test("mnemonic and raw seed restore the same Ethereum child accounts", async () => {
  const fromPhrase = new Vault(memory().storage);
  const fromSeed = new Vault(memory().storage);
  const seed = bytesToHex(mnemonicToSeedSync(phrase));
  await fromPhrase.create(password, phrase);
  await fromSeed.create(password, seed, "seed");
  for (let i = 1; i < 3; i++) {
    await fromPhrase.addAccount(`Account ${i + 1}`);
    await fromSeed.addAccount(`Account ${i + 1}`);
  }
  assert.deepEqual(
    (await fromSeed.view()).accounts.map((a) => a.address),
    (await fromPhrase.view()).accounts.map((a) => a.address),
  );
  assert.equal((await fromSeed.view()).wallets[0]?.kind, "seed");
  assert.equal(await fromSeed.reveal(password, undefined, "wallet-1"), seed);
  const single = new Vault(memory().storage);
  await single.create(password, key, "privateKey");
  await assert.rejects(single.addAccount("Sibling"), /one account/);
});

test("exported recovery material restores independently verified child addresses", async () => {
  // Public Anvil fixture, cross-checked with Foundry cast wallet address (indices 0–2).
  const expected = [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ];
  for (const kind of ["mnemonic", "seed"] as const) {
    const original = new Vault(memory().storage);
    await original.create(
      password,
      kind === "mnemonic" ? phrase : bytesToHex(mnemonicToSeedSync(phrase)),
      kind,
    );
    const backup = await original.reveal(password, undefined, "wallet-1");
    const recovered = new Vault(memory().storage);
    await recovered.create("different-recovery-password", backup, kind);
    await recovered.addAccount("Restored two");
    await recovered.addAccount("Restored three");
    assert.deepEqual(
      (await recovered.view()).accounts.map((item) => item.address),
      expected,
    );
  }
  const single = new Vault(memory().storage);
  await single.create(password, key, "privateKey");
  const recovered = new Vault(memory().storage);
  await recovered.create(
    "different-recovery-password",
    await single.reveal(password, undefined, "wallet-1"),
    "privateKey",
  );
  assert.equal(
    recovered.account().address,
    "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  );
});

test("wallet-scoped derivation, rename, backup and session restoration work across all sources", async () => {
  const store = memory();
  const session = memory();
  const vault = new Vault(store.storage, () => 1000, session.storage);
  await vault.create(password, phrase);
  await vault.renameWallet("wallet-1", "Personal");
  await vault.addWallet(
    "Trading",
    "seed",
    bytesToHex(mnemonicToSeedSync(otherPhrase)),
  );
  let view = await vault.view();
  const seedId = view.wallets[1]?.id;
  await vault.addAccount("Seed two");
  assert.equal(
    vault.account().address,
    mnemonicToAccount(otherPhrase, { addressIndex: 1 }).address,
  );
  await vault.addWallet("gox", "privateKey", key);
  await assert.rejects(vault.addAccount("Impossible"), /one account/);
  await vault.addAccount("aria", undefined, "wallet-1");
  assert.equal(
    vault.account().address,
    mnemonicToAccount(phrase, { addressIndex: 1 }).address,
  );
  await vault.addWallet("Fresh", "mnemonic");
  assert.throws(() => vault.account(), /Back up/);
  view = await vault.view();
  const freshId = view.wallets[3]?.id;
  const freshPhrase = await vault.reveal(password, undefined, freshId);
  await assert.rejects(vault.confirmBackup(phrase, freshId), /does not match/);
  await vault.confirmBackup(freshPhrase, freshId);
  assert.ok(vault.account().address);
  await vault.select(2);
  const expected = await vault.view();
  assert.equal(expected.accounts[2]?.walletId, seedId);
  const restarted = new Vault(store.storage, () => 1001, session.storage);
  await restarted.restoreSession();
  assert.deepEqual(await restarted.view(), expected);
  assert.equal(
    restarted.account().address,
    mnemonicToAccount(otherPhrase, { addressIndex: 1 }).address,
  );
  await restarted.changePassword(password, "another-disposable-password");
  restarted.lock();
  await restarted.unlock("another-disposable-password");
  assert.deepEqual(await restarted.view(), expected);
  const publicData = JSON.stringify(expected);
  const disk = JSON.stringify([...store.data]);
  for (const secret of [
    phrase,
    key,
    freshPhrase,
    bytesToHex(mnemonicToSeedSync(otherPhrase)),
  ]) {
    assert.ok(!publicData.includes(secret));
    assert.ok(!disk.includes(secret));
  }
  restarted.lock();
  assert.deepEqual((await restarted.view()).wallets, []);
});

test("invalid seeds and duplicate accounts cannot alter a wallet", async () => {
  const store = memory();
  const vault = new Vault(store.storage);
  await vault.create(password, phrase);
  const before = structuredClone(store.data.get("vault"));
  for (const seed of [
    "",
    "0x123",
    "00".repeat(15),
    "00".repeat(65),
    "gg".repeat(32),
  ])
    await assert.rejects(vault.addWallet("Invalid", "seed", seed));
  await assert.rejects(
    vault.addWallet(
      "Duplicate",
      "seed",
      bytesToHex(mnemonicToSeedSync(phrase)),
    ),
    /already exists/,
  );
  await assert.rejects(
    vault.addWallet("Duplicate", "mnemonic", phrase),
    /already exists/,
  );
  await assert.rejects(vault.addWallet("Invalid", "other", key), /Unsupported/);
  assert.deepEqual(store.data.get("vault"), before);
});

test("corrupt wallet ownership and future payload formats preserve encrypted storage", async () => {
  for (const override of [
    { version: 99 },
    { accounts: [{ name: "Bad", index: 0, walletId: "missing" }] },
    { accounts: [{ name: "Bad", index: 1, walletId: "wallet-1" }] },
    {
      accounts: [
        { name: "One", index: 0, walletId: "wallet-1" },
        { name: "Duplicate", index: 0, walletId: "wallet-1" },
      ],
    },
  ]) {
    const store = memory();
    const encrypted = await fixture({
      version: 2,
      wallets: [
        {
          id: "wallet-1",
          name: "Single",
          kind: "privateKey",
          secret: key,
          backedUp: true,
        },
      ],
      accounts: [{ name: "Account 1", index: 0, walletId: "wallet-1" }],
      selected: 0,
      autoLockMinutes: 30,
      autoLockPolicy: 1,
      ...override,
    });
    store.data.set("vault", encrypted);
    await assert.rejects(new Vault(store.storage).unlock(password));
    assert.deepEqual(store.data.get("vault"), encrypted);
  }
});

test("renaming a specified account preserves selection and rejects invalid indices", async () => {
  const store = memory();
  const vault = new Vault(store.storage);
  await vault.create(password, phrase);
  await vault.addWallet("Single", "privateKey", key);
  const before = await vault.view();
  await vault.rename("Personal account", 0);
  assert.equal((await vault.view()).selected, before.selected);
  assert.equal((await vault.view()).accounts[0]?.name, "Personal account");
  assert.equal((await vault.view()).accounts[1]?.name, "Account 1");
  assert.equal(vault.account().address, before.accounts[1]?.address);
  for (const index of [-1, 2, 0.5, "0"])
    await assert.rejects(vault.rename("Bad", index));
  vault.lock();
  await vault.unlock(password);
  assert.equal((await vault.view()).accounts[0]?.name, "Personal account");
  assert.equal((await vault.view()).selected, before.selected);
});
