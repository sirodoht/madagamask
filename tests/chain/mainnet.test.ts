import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { type Hex, recoverMessageAddress } from "viem";
import { client, type Network, rpc } from "../../src/core/networks.ts";
import type { Activity, Preview } from "../../src/core/transactions.ts";
import { Wallet } from "../../src/core/wallet.ts";

// A local chain reporting ID 1: the wallet signs real mainnet-format
// transactions, and nothing reaches Ethereum.
const site = { origin: "https://example.com", tabId: 1, documentId: "doc-1" };
const to = "0x0000000000000000000000000000000000000001";
let chain: ChildProcess;
let network: Network;
const data = new Map<string, unknown>();
const wallet = new Wallet({
  get: async (key) => structuredClone(data.get(key)),
  set: async (key, value) => {
    data.set(key, structuredClone(value));
  },
  remove: async (key) => {
    data.delete(key);
  },
});

before(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  network = {
    id: 1,
    name: "Ethereum",
    symbol: "ETH",
    rpc: `http://127.0.0.1:${address.port}`,
  };
  chain = spawn(
    "anvil",
    ["--port", String(address.port), "--chain-id", "1", "--silent"],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await rpc(network, "eth_chainId").catch(() => undefined);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await wallet.run("import", {
    password: "disposable-mainnet-password",
    phrase: "test test test test test test test test test test test junk",
  });
  await wallet.run("addNetwork", network);
  await wallet.run("selectNetwork", { id: 1 });
});
after(() => {
  chain?.kill("SIGTERM");
});

async function mined(hash: Hex) {
  const receipt = await client(network).waitForTransactionReceipt({
    hash,
    pollingInterval: 50,
    timeout: 5000,
  });
  assert.equal(receipt.status, "success");
  return client(network).getTransaction({ hash });
}

test("wallet send signs an EIP-1559 transaction bound to chain 1", async () => {
  const preview = (await wallet.run("prepareSend", {
    to,
    amount: "0.00001",
  })) as Preview;
  assert.equal(preview.chainId, 1);
  const activity = (await wallet.run("approveSend", {
    id: preview.id,
  })) as Activity;
  const sent = await mined(activity.hash);
  assert.equal(sent.chainId, 1);
  assert.equal(sent.type, "eip1559");
  assert.equal(sent.value, 10n ** 13n);
  await assert.rejects(
    wallet.run("approveSend", { id: preview.id }),
    /already used/,
  );
});

test("a site can connect, sign, and send on chain 1 only after approval", async () => {
  const approve = async (request: unknown) => {
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
    assert.equal(approval.chainId, 1);
    await wallet.run("approveDapp", { id: approval.id });
    return result;
  };
  const [account] = (await approve({
    method: "eth_requestAccounts",
  })) as Hex[];
  assert.ok(account);
  const signature = (await approve({
    method: "personal_sign",
    params: ["0x6869", account],
  })) as Hex;
  assert.equal(
    await recoverMessageAddress({ message: { raw: "0x6869" }, signature }),
    account,
  );
  const hash = (await approve({
    method: "eth_sendTransaction",
    params: [{ from: account, to, value: "0x1" }],
  })) as Hex;
  assert.equal((await mined(hash)).chainId, 1);
});
