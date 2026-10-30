import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverMessageAddress } from "viem";
import type { Site } from "../../src/core/dapps.ts";
import { Wallet } from "../../src/core/wallet.ts";

const site: Site = {
  origin: "https://example.com",
  tabId: 1,
  documentId: "doc-1",
};
async function setup() {
  const map = new Map<string, unknown>();
  const wallet = new Wallet({
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, structuredClone(value));
    },
    remove: async (key) => {
      map.delete(key);
    },
  });
  await wallet.run("import", {
    password: "disposable-test-password",
    phrase: "test test test test test test test test test test test junk",
  });
  return wallet;
}
async function pending(wallet: Wallet, request: unknown) {
  let ready = () => {};
  const shown = new Promise<void>((resolve) => {
    ready = resolve;
  });
  wallet.dapps.onRequest = async () => {
    ready();
  };
  const result = wallet.dapps.request(request, site);
  result.catch(() => {});
  await shown;
  const approval = wallet.dapps.approvals()[0];
  assert.ok(approval);
  return { result: () => result, approval };
}
test("sites get no accounts until approval; grants are origin scoped", async () => {
  const wallet = await setup();
  assert.deepEqual(
    await wallet.dapps.request({ method: "eth_accounts" }, site),
    [],
  );
  await assert.rejects(
    wallet.dapps.request({ method: "personal_sign", params: [] }, site),
    /Connect/,
  );
  const request = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: request.approval.id });
  assert.equal(((await request.result()) as string[]).length, 1);
  assert.deepEqual(await wallet.dapps.accounts("https://other.example"), []);
  await wallet.run("revoke", { origin: site.origin });
  assert.deepEqual(await wallet.dapps.accounts(site.origin), []);
});
test("message approval binds the original payload; lock rejects pending requests", async () => {
  const wallet = await setup();
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connect.approval.id });
  await connect.result();
  const account = (await wallet.dapps.accounts(site.origin))[0];
  assert.ok(account);
  const params = ["0x68656c6c6f", account];
  const signing = await pending(wallet, { method: "personal_sign", params });
  params[0] = "0x626164";
  await wallet.run("approveDapp", { id: signing.approval.id });
  const signature = await signing.result();
  assert.equal(
    await recoverMessageAddress({
      message: { raw: "0x68656c6c6f" },
      signature: signature as `0x${string}`,
    }),
    account,
  );
  const next = await pending(wallet, {
    method: "personal_sign",
    params: ["0x6869", account],
  });
  await wallet.run("lock", {});
  await assert.rejects(next.result(), /context changed/);
  assert.deepEqual(await wallet.dapps.accounts(site.origin), []);
});
test("unsupported methods, iframes handled by sender guard, and stale pages cannot approve", async () => {
  const wallet = await setup();
  await assert.rejects(
    wallet.dapps.request({ method: "eth_sign", params: [] }, site),
    /not supported/,
  );
  const request = await pending(wallet, { method: "eth_requestAccounts" });
  wallet.dapps.isSiteActive = () => false;
  await assert.rejects(
    wallet.run("approveDapp", { id: request.approval.id }),
    /no longer active/,
  );
  await assert.rejects(request.result(), /no longer active/);
  assert.deepEqual(await wallet.dapps.accounts(site.origin), []);
});

test("queued unlock cannot resurrect a wallet after an immediate lock", async () => {
  const wallet = await setup();
  await wallet.run("lock", {});
  const first = wallet.run("unlock", { password: "disposable-test-password" });
  const second = wallet.run("unlock", { password: "disposable-test-password" });
  const failed1 = assert.rejects(first, /locked/);
  const failed2 = assert.rejects(second, /locked/);
  await wallet.run("lock", {});
  await Promise.all([failed1, failed2]);
  assert.equal((await wallet.view()).vault.state, "locked");
});

test("duplicate requests, cross-account signatures, wrong-chain typed data, and tab closure are rejected", async () => {
  const wallet = await setup();
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await assert.rejects(
    wallet.dapps.request({ method: "eth_requestAccounts" }, site),
    /already pending/,
  );
  await wallet.run("approveDapp", { id: connect.approval.id });
  await connect.result();
  const account = (await wallet.dapps.accounts(site.origin))[0];
  assert.ok(account);
  await assert.rejects(
    wallet.dapps.request(
      {
        method: "personal_sign",
        params: ["0x00", "0x0000000000000000000000000000000000000001"],
      },
      site,
    ),
    /does not match/,
  );
  await assert.rejects(
    wallet.dapps.request(
      {
        method: "eth_signTypedData_v4",
        params: [
          account,
          {
            domain: { chainId: 1 },
            types: { Message: [{ name: "text", type: "string" }] },
            primaryType: "Message",
            message: { text: "test" },
          },
        ],
      },
      site,
    ),
    /another chain/,
  );
  const signing = await pending(wallet, {
    method: "personal_sign",
    params: ["0x00", account],
  });
  wallet.dapps.rejectTab(site.tabId);
  await assert.rejects(signing.result(), /closed or navigated/);
});
