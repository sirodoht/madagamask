import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_KEY, type Storage, Vault } from "../../src/core/vault.ts";

const mnemonic = "test test test test test test test test test test test junk";
const password = "disposable-session-test-password";
function memory() {
  const data = new Map<string, unknown>();
  const storage: Storage = {
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => {
      data.set(key, structuredClone(value));
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
}
function setup() {
  const disk = memory();
  const session = memory();
  let now = 1000;
  const make = () => new Vault(disk.storage, () => now, session.storage);
  return {
    disk,
    session,
    make,
    time: (value: number) => {
      now = value;
    },
  };
}

test("background restoration retains signing and account changes without persisting secrets to disk", async () => {
  const { disk, session, make } = setup();
  const first = make();
  await first.create(password, mnemonic);
  await first.addAccount("Second");
  await first.addAccount("Imported", `0x${"11".repeat(32)}`);
  const saved = session.data.get(SESSION_KEY) as Record<string, unknown>;
  assert.deepEqual(Object.keys(saved).sort(), [
    "expiresAt",
    "key",
    "lastActivity",
    "salt",
    "version",
  ]);
  assert.equal(saved.expiresAt, 1000 + 30 * 60_000);
  const diskText = JSON.stringify([...disk.data]);
  assert.ok(!diskText.includes(saved.key as string));
  assert.ok(!diskText.includes(mnemonic));
  assert.ok(!diskText.includes(password));
  assert.ok(!JSON.stringify(saved).includes(mnemonic));
  const resumed = make();
  await resumed.restoreSession();
  assert.deepEqual(await resumed.view(), await first.view());
  assert.equal(resumed.account().address, first.account().address);
  const signature = await resumed
    .account()
    .signMessage({ message: "restored session" });
  assert.match(signature, /^0x[0-9a-f]{130}$/i);
  await resumed.rename("Restored account");
  const again = make();
  await again.restoreSession();
  assert.equal((await again.view()).accounts[2]?.name, "Restored account");
  session.data.clear(); // Browser restart / extension reload.
  const restarted = make();
  await restarted.restoreSession();
  assert.equal((await restarted.view()).state, "locked");
});

test("expiry survives background restarts, polling does not renew it, and activity does", async () => {
  const { session, make, time } = setup();
  const first = make();
  await first.create(password, mnemonic);
  time(30 * 60_000);
  const resumed = make();
  await resumed.restoreSession();
  assert.equal((await resumed.view()).state, "unlocked");
  await resumed.view();
  assert.equal(
    (session.data.get(SESSION_KEY) as { lastActivity: number }).lastActivity,
    1000,
  );
  resumed.touch();
  await resumed.flushSession();
  time(30 * 60_000 + 1000);
  const active = make();
  await active.restoreSession();
  assert.equal((await active.view()).state, "unlocked");
  time(60 * 60_000);
  const expired = make();
  await expired.restoreSession();
  assert.equal((await expired.view()).state, "locked");
  assert.equal(session.data.has(SESSION_KEY), false);
});

test("manual lock, reset, and password changes cannot restore old sessions", async () => {
  const { session, make } = setup();
  const vault = make();
  await vault.create(password, mnemonic);
  const previous = structuredClone(session.data.get(SESSION_KEY));
  await vault.changePassword(password, "a-different-session-password");
  const resumed = make();
  await resumed.restoreSession();
  assert.equal((await resumed.view()).state, "unlocked");
  session.data.set(SESSION_KEY, previous);
  const stale = make();
  await stale.restoreSession();
  assert.equal((await stale.view()).state, "locked");
  await resumed.unlock("a-different-session-password");
  resumed.lock();
  await resumed.flushSession();
  assert.equal(session.data.has(SESSION_KEY), false);
  await resumed.unlock("a-different-session-password");
  await resumed.reset("a-different-session-password", "DELETE");
  await resumed.flushSession();
  const reset = make();
  await reset.restoreSession();
  assert.equal((await reset.view()).state, "not-created");
});

test("malformed keys, modified expiry, and backward clocks fail closed", async () => {
  for (const modification of [
    { key: "bad" },
    { expiresAt: 99999999 },
    { version: 2 },
    { lastActivity: 1001 },
  ]) {
    const { session, make } = setup();
    await make().create(password, mnemonic);
    const saved = session.data.get(SESSION_KEY) as object;
    session.data.set(SESSION_KEY, { ...saved, ...modification });
    const resumed = make();
    await resumed.restoreSession();
    assert.equal((await resumed.view()).state, "locked");
    assert.equal(session.data.has(SESSION_KEY), false);
  }
});

test("Lock during session restoration invalidates the result", async () => {
  const { session, make, disk } = setup();
  await make().create(password, mnemonic);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: Storage = {
    ...session.storage,
    get: async (key) => {
      const saved = await session.storage.get(key);
      await gate;
      return saved;
    },
  };
  const resumed = new Vault(disk.storage, () => 1000, slow);
  const restoring = resumed.restoreSession();
  resumed.lock();
  release();
  await restoring;
  await resumed.flushSession();
  assert.equal((await resumed.view()).state, "locked");
  assert.equal(session.data.has(SESSION_KEY), false);
});

test("Lock waits for a pending write and removes it; write failure locks the vault", async () => {
  const { session, disk } = setup();
  let release = () => {};
  let entered = () => {};
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: Storage = {
    ...session.storage,
    set: async (key, value) => {
      entered();
      await gate;
      await session.storage.set(key, value);
    },
  };
  const vault = new Vault(disk.storage, () => 1000, slow);
  const creating = vault.create(password, mnemonic);
  await reached;
  vault.lock();
  release();
  await creating;
  await vault.flushSession();
  assert.equal((await vault.view()).state, "locked");
  assert.equal(session.data.has(SESSION_KEY), false);
  const broken = new Vault(disk.storage, () => 1000, {
    ...session.storage,
    set: async () => {
      throw new Error("unavailable");
    },
  });
  await assert.rejects(broken.unlock(password), /Could not save/);
  assert.equal((await broken.view()).state, "locked");
  assert.equal(session.data.has(SESSION_KEY), false);
});

test("shorter explicit auto-lock settings survive restoration", async () => {
  const { make, time } = setup();
  const vault = make();
  await vault.create(password, mnemonic);
  await vault.autoLock(5);
  const resumed = make();
  await resumed.restoreSession();
  assert.equal((await resumed.view()).autoLockMinutes, 5);
  time(301000);
  assert.throws(() => resumed.account(), /Unlock/);
  await resumed.flushSession();
  const expired = make();
  await expired.restoreSession();
  assert.equal((await expired.view()).state, "locked");
});

test("legacy default migrates to 30 minutes while other legacy preferences remain", async () => {
  for (const minutes of [5, 2]) {
    const { disk, session, make } = setup();
    const vault = make();
    await vault.create(password, mnemonic);
    const saved = session.data.get(SESSION_KEY) as { key: string };
    const encrypted = disk.data.get("vault") as {
      iv: string;
      ciphertext: string;
    };
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from(saved.key, "base64"),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    const additionalData = new TextEncoder().encode("madagamask:vault:1");
    const data = JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: Buffer.from(encrypted.iv, "base64"),
            additionalData,
          },
          key,
          Buffer.from(encrypted.ciphertext, "base64"),
        ),
      ),
    );
    delete data.autoLockPolicy;
    data.autoLockMinutes = minutes;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      key,
      new TextEncoder().encode(JSON.stringify(data)),
    );
    disk.data.set("vault", {
      ...encrypted,
      iv: Buffer.from(iv).toString("base64"),
      ciphertext: Buffer.from(ciphertext).toString("base64"),
    });
    vault.lock();
    await vault.flushSession();
    await vault.unlock(password);
    assert.equal(
      (await vault.view()).autoLockMinutes,
      minutes === 5 ? 30 : minutes,
    );
    const resumed = make();
    await resumed.restoreSession();
    assert.equal((await resumed.view()).state, "unlocked");
  }
});
