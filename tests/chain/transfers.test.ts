import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
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
  await client(network).waitForTransactionReceipt({
    hash: activity.hash,
    pollingInterval: 50,
    timeout: 5000,
  });
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
