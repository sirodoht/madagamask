import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { endpoint, Networks, SIGNING_CHAINS } from "../../src/core/networks.ts";

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
  assert.equal(SIGNING_CHAINS.has(1), false);
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
