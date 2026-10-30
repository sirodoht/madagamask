import assert from "node:assert/strict";
import { test } from "node:test";
import { type Storage, Vault } from "../../src/core/vault.ts";

const mnemonic = "test test test test test test test test test test test junk";
const password = "disposable-test-password";
function memory() {
  const data = new Map<string, unknown>();
  let fail = false;
  const storage: Storage = {
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => {
      if (fail) throw new Error("write failed");
      data.set(key, structuredClone(value));
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return {
    data,
    storage,
    fail: () => {
      fail = true;
    },
  };
}
test("vault restores known addresses, encrypts secrets, locks, and changes passwords", async () => {
  const { data, storage } = memory();
  const vault = new Vault(storage);
  await vault.create(password, mnemonic);
  assert.equal(
    (await vault.view()).accounts[0]?.address,
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  );
  assert.ok(!JSON.stringify([...data]).includes(mnemonic));
  await vault.addAccount("Second");
  assert.equal(
    (await vault.view()).accounts[1]?.address,
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  );
  await vault.changePassword(password, "a-different-test-password");
  vault.lock();
  await assert.rejects(vault.unlock(password), /Incorrect password/);
  await vault.unlock("a-different-test-password");
  assert.equal((await vault.view()).accounts.length, 2);
  assert.equal(await vault.reveal("a-different-test-password"), mnemonic);
  const restarted = new Vault(storage);
  assert.equal((await restarted.view()).state, "locked");
  await restarted.unlock("a-different-test-password");
  assert.deepEqual(
    (await restarted.view()).accounts,
    (await vault.view()).accounts,
  );
});
test("failed writes preserve the old vault and in-memory account list", async () => {
  const store = memory();
  const vault = new Vault(store.storage);
  await vault.create(password, mnemonic);
  const before = structuredClone(store.data.get("vault"));
  store.fail();
  await assert.rejects(vault.addAccount("Not saved"));
  assert.deepEqual(store.data.get("vault"), before);
  assert.equal((await vault.view()).accounts.length, 1);
});
test("tampered ciphertext and future formats fail without overwriting storage", async () => {
  const store = memory();
  const vault = new Vault(store.storage);
  await vault.create(password, mnemonic);
  vault.lock();
  const saved = store.data.get("vault") as Record<string, unknown>;
  const ciphertext = saved.ciphertext as string;
  store.data.set("vault", {
    ...saved,
    ciphertext: `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`,
  });
  await assert.rejects(vault.unlock(password), /Incorrect password or damaged/);
  store.data.set("vault", { ...saved, version: 99 });
  await assert.rejects(vault.unlock(password), /Unsupported vault/);
  assert.equal(
    (store.data.get("vault") as Record<string, unknown>).version,
    99,
  );
});
test("auto-lock and explicit lock invalidate in-flight unlock", async () => {
  const { storage } = memory();
  let now = 0;
  const vault = new Vault(storage, () => now);
  await vault.create(password, mnemonic);
  now = 300_000;
  vault.expire();
  assert.equal((await vault.view()).state, "locked");
  const unlocking = vault.unlock(password);
  vault.lock();
  await assert.rejects(unlocking, /locked during/);
  assert.equal((await vault.view()).state, "locked");
});
test("backup confirmation gates signing; checksum and reset are validated", async () => {
  const { storage } = memory();
  const vault = new Vault(storage);
  await assert.rejects(vault.create(password, "test ".repeat(12)), /checksum/);
  await vault.create(password);
  assert.throws(() => vault.account(), /Back up/);
  const phrase = await vault.reveal(password);
  await vault.confirmBackup(phrase);
  assert.ok(vault.account().address);
  await assert.rejects(vault.reset(password, "no"), /DELETE/);
  await vault.reset(password, "DELETE");
  assert.equal((await vault.view()).state, "not-created");
});

test("imported keys have separate backups and wrong-password reset preserves the wallet", async () => {
  const { storage } = memory();
  const vault = new Vault(storage);
  await vault.create(password, mnemonic);
  const key = `0x${"11".repeat(32)}`;
  await vault.addAccount("Imported", key);
  assert.equal((await vault.view()).accounts[1]?.imported, true);
  assert.equal(await vault.reveal(password, 1), key);
  assert.equal(await vault.reveal(password), mnemonic);
  let deleted = false;
  await assert.rejects(
    vault.reset("wrong-password-value", "DELETE", async () => {
      deleted = true;
    }),
  );
  assert.equal(deleted, false);
  assert.equal((await vault.view()).state, "unlocked");
});
