import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  client,
  endpoint,
  Networks,
  rpc,
  SIGNING_CHAINS,
} from "../../src/core/networks.ts";
import { userErrorMessage } from "../../src/core/validation.ts";

test("RPC URLs reject plaintext remote hosts, embedded credentials, and non-HTTP schemes", () => {
  assert.equal(endpoint("https://example.com"), "https://example.com/");
  assert.equal(endpoint("http://127.0.0.1:8545"), "http://127.0.0.1:8545/");
  for (const value of [
    "file:///tmp/key",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/#key",
    "javascript:alert(1)",
  ])
    assert.throws(() => endpoint(value));
  assert.equal(SIGNING_CHAINS.has(1), true);
  assert.equal(SIGNING_CHAINS.has(137), false);
});
test("custom networks verify chain ID and preserve selected-network balance context", async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: data.id,
        result: data.method === "eth_chainId" ? "0x7a69" : "0xde0b6b3a7640000",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const map = new Map<string, unknown>();
    const networks = new Networks({
      get: async (key) => map.get(key),
      set: async (key, value) => {
        map.set(key, value);
      },
      remove: async (key) => {
        map.delete(key);
      },
    });
    const network = {
      id: 31337,
      name: "Local",
      rpc: `http://127.0.0.1:${address.port}`,
      symbol: "ETH",
    };
    await assert.rejects(networks.add({ ...network, id: 1 }), /chain ID/);
    await networks.add(network);
    await networks.select(31337);
    const balance = await networks.balance(
      "0x0000000000000000000000000000000000000001",
    );
    assert.equal(balance.amount, "1");
    assert.equal(balance.chainId, 31337);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("RPC failures stay bounded, preserve safe feedback through the client, and recover on retry", async (t) => {
  let mode = "timeout";
  let requests = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests += 1;
    if (mode === "timeout") return;
    response.setHeader("Content-Type", "application/json");
    if (mode === "body-timeout") {
      response.write('{"jsonrpc":"2.0",');
      return;
    }
    if (mode === "offline") {
      response.destroy();
      return;
    }
    response.end(
      mode === "malformed"
        ? "not JSON"
        : JSON.stringify({
            jsonrpc: "2.0",
            id: data.id,
            result: "0x7a69",
          }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  assert.ok(bound && typeof bound !== "string");
  const network = {
    id: 31337,
    name: "Failure test",
    symbol: "ETH",
    rpc: `http://127.0.0.1:${bound.port}`,
  };
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", () => timeout(100));
  try {
    for (const [failure, message] of [
      [
        "timeout",
        "RPC unavailable or timed out. Check the network and try again.",
      ],
      [
        "body-timeout",
        "RPC response interrupted or timed out. Check the network and try again.",
      ],
      [
        "offline",
        "RPC unavailable or timed out. Check the network and try again.",
      ],
      ["malformed", "Invalid RPC response."],
    ]) {
      mode = failure as string;
      const before = requests;
      await assert.rejects(client(network).getChainId(), (error: unknown) => {
        assert.equal(userErrorMessage(error, "generic failure"), message);
        return true;
      });
      assert.equal(
        requests,
        before + 1,
        "failed requests are not silently retried",
      );
      mode = "healthy";
      assert.equal(await rpc(network, "eth_chainId"), "0x7a69");
    }
    assert.equal(
      userErrorMessage(new Error("secret RPC payload"), "safe fallback"),
      "safe fallback",
    );
    const cyclic = new Error("cyclic cause");
    cyclic.cause = cyclic;
    assert.equal(userErrorMessage(cyclic, "safe fallback"), "safe fallback");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
