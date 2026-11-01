import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, test } from "node:test";
import { type Hex, recoverMessageAddress } from "viem";
import { client, type Network, rpc } from "../../src/core/networks.ts";
import type { Activity, Preview } from "../../src/core/transactions.ts";
import { Wallet } from "../../src/core/wallet.ts";

const site = { origin: "https://example.com", tabId: 1, documentId: "doc-1" };
const to = "0x0000000000000000000000000000000000000001";
const chains: ChildProcess[] = [];
after(() => {
  for (const chain of chains) chain.kill("SIGTERM");
});

async function launch(id: number, args: string[] = []) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const network: Network = {
    id,
    name: "Custom chain",
    symbol: "CST",
    rpc: `http://127.0.0.1:${address.port}`,
  };
  chains.push(
    spawn(
      "anvil",
      [
        "--port",
        String(address.port),
        "--chain-id",
        String(id),
        "--silent",
      ].concat(args),
      { stdio: "ignore" },
    ),
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await rpc(network, "eth_chainId").catch(() => undefined);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
  await wallet.run("import", {
    password: "disposable-custom-password",
    phrase: "test test test test test test test test test test test junk",
  });
  return { network, wallet };
}

async function approved(wallet: Wallet, request: unknown) {
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
  await wallet.run("approveDapp", { id: approval.id });
  return result;
}

async function mined(network: Network, hash: Hex) {
  const receipt = await client(network).waitForTransactionReceipt({
    hash,
    pollingInterval: 50,
    timeout: 5000,
  });
  assert.equal(receipt.status, "success");
  return client(network).getTransaction({ hash });
}

for (const [fees, args, type] of [
  ["EIP-1559", [], "eip1559"],
  ["legacy", ["--hardfork", "berlin"], "legacy"],
] as const)
  test(`wallet sends on a custom chain with ${fees} fees`, async () => {
    const { network, wallet } = await launch(4242, [...args]);
    await wallet.run("addNetwork", network);
    await wallet.run("selectNetwork", { id: network.id });
    const preview = (await wallet.run("prepareSend", {
      to,
      amount: "0.00001",
    })) as Preview;
    assert.equal(preview.chainId, 4242);
    const activity = (await wallet.run("approveSend", {
      id: preview.id,
    })) as Activity;
    const sent = await mined(network, activity.hash);
    assert.equal(sent.chainId, 4242);
    assert.equal(sent.type, type);
    assert.equal(sent.value, 10n ** 13n);
  });

test("a site adds a custom network, then signs and sends on it after approval", async () => {
  const { network, wallet } = await launch(4243);
  const [account] = (await approved(wallet, {
    method: "eth_requestAccounts",
  })) as Hex[];
  assert.ok(account);
  await approved(wallet, {
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: "0x1093",
        chainName: network.name,
        nativeCurrency: {
          name: "Custom",
          symbol: network.symbol,
          decimals: 18,
        },
        rpcUrls: [network.rpc],
      },
    ],
  });
  await approved(wallet, {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x1093" }],
  });
  const signature = (await approved(wallet, {
    method: "personal_sign",
    params: ["0x6869", account],
  })) as Hex;
  assert.equal(
    await recoverMessageAddress({ message: { raw: "0x6869" }, signature }),
    account,
  );
  const hash = (await approved(wallet, {
    method: "eth_sendTransaction",
    params: [{ from: account, to, value: "0x1" }],
  })) as Hex;
  assert.equal((await mined(network, hash)).chainId, 4243);
});
