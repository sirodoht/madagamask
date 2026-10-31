import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { createWalletClient, custom, erc20Abi, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { client, type Network, rpc } from "../../src/core/networks.ts";
import {
  type Activity,
  amount,
  type Preview,
} from "../../src/core/transactions.ts";
import { Wallet } from "../../src/core/wallet.ts";

let process: ChildProcess;
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
    id: 31337,
    name: "Anvil",
    symbol: "ETH",
    rpc: `http://127.0.0.1:${address.port}`,
  };
  process = spawn("anvil", ["--port", String(address.port), "--silent"], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    process.once("error", reject);
    const start = Date.now();
    const timer = setInterval(() => {
      void rpc(network, "eth_chainId")
        .then(() => {
          clearInterval(timer);
          resolve();
        })
        .catch(() => {
          if (Date.now() - start > 10_000) {
            clearInterval(timer);
            reject(new Error("Anvil did not start"));
          }
        });
    }, 100);
  });
  await wallet.run("import", {
    password: "disposable-test-password",
    phrase: "test test test test test test test test test test test junk",
  });
  await wallet.run("addNetwork", network);
  await wallet.run("selectNetwork", { id: 31337 });
});
after(() => {
  process?.kill("SIGTERM");
});
test("amounts reject floats, exponent notation, excess precision, and invalid values", () => {
  assert.equal(amount("0.000000000000000001"), 1n);
  for (const value of ["1e-3", "-1", "0", "0.0000000000000000001", 1.5])
    assert.throws(() => amount(value));
});
test("send, confirm, reject duplicate approval, and persist activity across restart", async () => {
  const to = "0x0000000000000000000000000000000000000001";
  const preview = (await wallet.run("prepareSend", {
    to,
    amount: "1",
  })) as Preview;
  const activity = (await wallet.run("approveSend", {
    id: preview.id,
  })) as Activity;
  assert.equal(activity.status, "pending");
  const receipt = await client(network).waitForTransactionReceipt({
    hash: activity.hash,
    pollingInterval: 50,
    timeout: 5000,
  });
  assert.equal(
    receipt.status,
    "success",
    JSON.stringify({ gasUsed: receipt.gasUsed.toString(), gas: activity.gas }),
  );
  await assert.rejects(
    wallet.run("approveSend", { id: preview.id }),
    /already used/,
  );
  assert.equal(await client(network).getBalance({ address: to }), 10n ** 18n);
  const refreshed = (await wallet.run("refreshActivity", {})) as Activity[];
  assert.equal(refreshed[0]?.status, "confirmed");
  assert.ok(JSON.stringify(data.get("activity")).includes(activity.hash));
});
test("insufficient funds and changed account invalidate sends", async () => {
  await assert.rejects(
    wallet.run("prepareSend", {
      to: "0x0000000000000000000000000000000000000001",
      amount: "999999999",
    }),
    /Insufficient balance/,
  );
  const preview = (await wallet.run("prepareSend", {
    to: "0x0000000000000000000000000000000000000001",
    amount: "1",
  })) as Preview;
  await wallet.run("lock", {});
  await assert.rejects(
    wallet.run("approveSend", { id: preview.id }),
    /expired/,
  );
  await wallet.run("unlock", { password: "disposable-test-password" });
});
test("pending transactions support fee-bumped cancellation", async () => {
  await rpc(network, "evm_setAutomine", [false]);
  const preview = (await wallet.run("prepareSend", {
    to: "0x0000000000000000000000000000000000000001",
    amount: "2",
  })) as Preview;
  const initial = (await wallet.run("approveSend", {
    id: preview.id,
  })) as Activity;
  const replacement = (await wallet.run("replaceTransaction", {
    hash: initial.hash,
    cancel: true,
  })) as Preview;
  const cancelled = (await wallet.run("approveSend", {
    id: replacement.id,
  })) as Activity;
  await rpc(network, "evm_mine", []);
  await rpc(network, "evm_setAutomine", [true]);
  const items = (await wallet.run("refreshActivity", {})) as Activity[];
  assert.equal(
    items.find((item) => item.hash === cancelled.hash)?.status,
    "confirmed",
  );
  assert.equal(
    items.find((item) => item.hash === initial.hash)?.status,
    "replaced",
  );
});

test("import a token, read exact balance, transfer it, and decode approval intent", async () => {
  const fixture = JSON.parse(
    await readFile("tests/fixtures/test-token.json", "utf8"),
  );
  const account = mnemonicToAccount(
    "test test test test test test test test test test test junk",
  );
  const chain = client(network).chain;
  const deployer = createWalletClient({
    account,
    chain,
    transport: custom({
      request: ({ method, params }) =>
        rpc(network, method, params as unknown[]),
    }),
  });
  const hash = await deployer.deployContract({
    abi: fixture.abi,
    bytecode: fixture.bytecode as Hex,
  });
  const receipt = await client(network).waitForTransactionReceipt({
    hash,
    pollingInterval: 50,
  });
  assert.ok(receipt.contractAddress);
  await assert.rejects(
    wallet.run("prepareSend", { to: receipt.contractAddress, amount: "1" }),
    /Could not estimate the network fee/,
  );
  const imported = (await wallet.run("importToken", {
    address: receipt.contractAddress,
  })) as { decimals: number; symbol: string };
  assert.equal(imported.decimals, 6);
  assert.equal(imported.symbol, "MTEST");
  const before = (await wallet.run("tokenBalance", {
    address: receipt.contractAddress,
  })) as { balance: string };
  assert.equal(before.balance, "1000");
  const to = "0x0000000000000000000000000000000000001234";
  const preview = (await wallet.run("prepareTokenSend", {
    address: receipt.contractAddress,
    to,
    amount: "1.234567",
  })) as Preview;
  assert.equal(preview.interpretation.kind, "token-transfer");
  assert.equal(preview.asset?.recipient, to);
  assert.equal(preview.asset?.amount, "1.234567");
  assert.equal(preview.asset?.symbol, "MTEST");
  assert.equal(
    preview.asset?.contract.toLowerCase(),
    receipt.contractAddress.toLowerCase(),
  );
  assert.equal(preview.simulation.status, "passed");
  const result = (await wallet.run("approveSend", {
    id: preview.id,
  })) as Activity;
  await client(network).waitForTransactionReceipt({
    hash: result.hash,
    pollingInterval: 50,
  });
  assert.equal(
    await client(network).readContract({
      address: receipt.contractAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [to],
    }),
    1234567n,
  );
  await wallet.run("removeToken", { address: receipt.contractAddress });
  assert.deepEqual(await wallet.run("tokens", {}), []);
});

async function freshWallet(rpcUrl = network.rpc, failActivity = () => false) {
  const map = new Map<string, unknown>();
  const wallet = new Wallet({
    get: async (key) => structuredClone(map.get(key)),
    set: async (key, value) => {
      if (key === "activity" && failActivity())
        throw new Error("interrupted storage write");
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
  await wallet.run("addNetwork", { ...network, rpc: rpcUrl });
  await wallet.run("selectNetwork", { id: 31337 });
  return { wallet, map };
}
test("failed pre-broadcast persistence prevents submission", async () => {
  let fail = false;
  const { wallet } = await freshWallet(network.rpc, () => fail);
  const account = wallet.vault.account().address;
  const before = await client(network).getTransactionCount({
    address: account,
  });
  const preview = (await wallet.run("prepareSend", {
    to: "0x0000000000000000000000000000000000001234",
    amount: "0.001",
  })) as Preview;
  fail = true;
  await assert.rejects(
    wallet.run("approveSend", { id: preview.id }),
    /interrupted storage/,
  );
  assert.equal(
    await client(network).getTransactionCount({ address: account }),
    before,
  );
});
test("ambiguous RPC submission preserves its hash and is resolved without resending", async () => {
  let broadcasts = 0;
  const proxy = createHttpServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const upstream = await fetch(network.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    });
    const result = await upstream.text();
    if (body.method === "eth_sendRawTransaction") {
      broadcasts += 1;
      response.writeHead(503).end("simulated lost response");
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(result);
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const bound = proxy.address();
  if (!bound || typeof bound === "string") throw new Error("No proxy port");
  try {
    const { wallet, map } = await freshWallet(`http://127.0.0.1:${bound.port}`);
    const preview = (await wallet.run("prepareSend", {
      to: "0x0000000000000000000000000000000000001234",
      amount: "0.002",
    })) as Preview;
    const sent = (await wallet.run("approveSend", {
      id: preview.id,
    })) as Activity;
    assert.equal(sent.status, "unknown");
    assert.ok(JSON.stringify(map.get("activity")).includes(sent.hash));
    await assert.rejects(
      wallet.run("prepareSend", {
        to: "0x0000000000000000000000000000000000001234",
        amount: "0.002",
      }),
      /uncertain/,
    );
    await client(network).waitForTransactionReceipt({
      hash: sent.hash,
      pollingInterval: 50,
    });
    const items = (await wallet.run("refreshActivity", {})) as Activity[];
    assert.equal(items[0]?.status, "confirmed");
    assert.equal(broadcasts, 1);
  } finally {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
test("a chain rollback removes a previously observed confirmation", async () => {
  const { wallet } = await freshWallet();
  const snapshot = await rpc(network, "evm_snapshot");
  const preview = (await wallet.run("prepareSend", {
    to: "0x0000000000000000000000000000000000001234",
    amount: "0.003",
  })) as Preview;
  const sent = (await wallet.run("approveSend", {
    id: preview.id,
  })) as Activity;
  await client(network).waitForTransactionReceipt({
    hash: sent.hash,
    pollingInterval: 50,
  });
  assert.equal(
    ((await wallet.run("refreshActivity", {})) as Activity[])[0]?.status,
    "confirmed",
  );
  await rpc(network, "evm_revert", [snapshot]);
  assert.notEqual(
    ((await wallet.run("refreshActivity", {})) as Activity[])[0]?.status,
    "confirmed",
  );
});

test("dapp dismissal during persistence prevents broadcasting a signed transaction", async () => {
  let active = true;
  const { wallet } = await freshWallet(network.rpc, () => {
    active = false;
    return false;
  });
  const from = wallet.vault.account().address;
  const before = await client(network).getTransactionCount({ address: from });
  const preview = await wallet.transactions.prepare(
    "0x0000000000000000000000000000000000001234",
    "0.001",
  );
  await assert.rejects(
    wallet.transactions.approve(preview.id, () => {
      if (!active) throw new Error("Request dismissed");
    }),
    /dismissed/,
  );
  assert.equal(
    await client(network).getTransactionCount({ address: from }),
    before,
  );
});
