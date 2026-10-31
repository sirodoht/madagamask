import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, erc20Abi } from "viem";
import { presentActivity } from "../../src/core/activity.ts";
import type { Token } from "../../src/core/tokens.ts";
import type { Activity } from "../../src/core/transactions.ts";

const item: Activity = {
  hash: `0x${"ab".repeat(32)}`,
  chainId: 11155111,
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  value: "1000000000000000001",
  data: "0x",
  nonce: 0,
  gas: "21000",
  createdAt: 0,
  status: "pending",
};
const network = {
  id: item.chainId,
  name: "Sepolia",
  symbol: "ETH",
  rpc: "https://example.invalid",
};

test("activity preserves native precision and uses only known-chain transaction links", () => {
  const shown = presentActivity(item, network);
  assert.equal(shown.display.amount, "1.000000000000000001 ETH");
  assert.equal(
    shown.display.explorer,
    `https://sepolia.etherscan.io/tx/${item.hash}`,
  );
  assert.equal(
    presentActivity({ ...item, chainId: 31337 }, network).display.explorer,
    "",
  );
  assert.equal(item.status, "pending");
});

test("uncertain, reverted, and stale results never masquerade as confirmed success", () => {
  const unknown = presentActivity(
    { ...item, status: "unknown", error: "Submission result uncertain." },
    network,
  );
  assert.equal(unknown.display.status, "Status unknown");
  assert.equal(unknown.display.note, "Submission result uncertain.");
  assert.notEqual(unknown.display.tone, "success");
  const failed = presentActivity({ ...item, status: "reverted" }, network);
  assert.equal(failed.display.status, "Failed");
  assert.match(failed.display.note, /fees may still apply/);
  const stale = presentActivity(
    { ...item, status: "confirmed", error: "Status unavailable" },
    network,
  );
  assert.equal(stale.display.status, "Confirmed · stale");
  assert.notEqual(stale.display.tone, "success");
});

test("token activity decodes the recipient and precision without confusing token units with ETH", () => {
  const token: Token = {
    address: item.to,
    chainId: item.chainId,
    decimals: 6,
    name: "Test",
    symbol: "TEST",
  };
  const recipient = "0x0000000000000000000000000000000000001234";
  const transfer = {
    ...item,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, 1234567n],
    }),
  };
  const shown = presentActivity(transfer, network, [token]);
  assert.equal(shown.display.amount, "1.234567 TEST");
  assert.equal(shown.display.recipient, recipient);
  assert.equal(
    presentActivity(transfer, network, [{ ...token, chainId: 1 }]).display
      .amount,
    "1234567 token base units",
  );
  assert.equal(
    presentActivity({ ...transfer, value: item.value }, network, [token])
      .display.amount,
    "1.234567 TEST + 1.000000000000000001 ETH",
  );
  const contract = presentActivity({ ...item, data: "0x12345678" }, network);
  assert.equal(contract.display.title, "Contract interaction");
  assert.equal(contract.display.amount, "1.000000000000000001 ETH");
});
