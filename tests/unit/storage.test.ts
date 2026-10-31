import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionStorage } from "../../src/browser/storage.ts";

function area() {
  const calls: string[] = [];
  return {
    calls,
    get: async () => {
      calls.push("get");
      return { vault: "ciphertext" };
    },
    set: async () => {
      calls.push("set");
    },
    remove: async () => {
      calls.push("remove");
    },
  };
}

test("wallet storage waits for access restrictions before reading or writing", async () => {
  const store = area();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const secured = extensionStorage(
    {
      ...store,
      setAccessLevel: async (options) => {
        assert.equal(options.accessLevel, "TRUSTED_CONTEXTS");
        await gate;
      },
    },
    true,
  );
  const read = secured.get("vault");
  const write = secured.set("vault", "updated");
  const remove = secured.remove("vault");
  await Promise.resolve();
  assert.deepEqual(store.calls, []);
  release();
  assert.equal(await read, "ciphertext");
  await Promise.all([write, remove]);
  assert.deepEqual(store.calls, ["get", "set", "remove"]);
});

test("failed or missing required storage isolation blocks all wallet access", async () => {
  for (const failing of [true, false]) {
    const store = area();
    const secured = extensionStorage(
      {
        ...store,
        ...(failing
          ? {
              setAccessLevel: async () => {
                throw new Error("restriction failed");
              },
            }
          : {}),
      },
      true,
    );
    await assert.rejects(
      secured.get("vault"),
      /restriction failed|cannot isolate/,
    );
    await assert.rejects(secured.set("vault", "updated"));
    await assert.rejects(secured.remove("vault"));
    assert.deepEqual(store.calls, []);
  }
});
