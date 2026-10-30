import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
} from "viem";
import {
  blockedHost,
  Phishing,
  parseDomains,
} from "../../src/core/phishing.ts";
import {
  editAllowance,
  interpret,
  tokenAmount,
} from "../../src/core/tokens.ts";

test("token quantities preserve exact decimals and unlimited approvals are explicit", () => {
  assert.equal(tokenAmount("1.000001", 6), 1000001n);
  assert.throws(() => tokenAmount("1.0000001", 6));
  assert.throws(() => tokenAmount("1e6", 18));
  const spender = "0x0000000000000000000000000000000000000001";
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
  });
  assert.match(interpret(data, spender).summary, /UNLIMITED/);
  const edited = decodeFunctionData({
    abi: erc20Abi,
    data: editAllowance(data, "0"),
  });
  assert.equal(edited.functionName, "approve");
  assert.equal(edited.args?.[1], 0n);
  assert.equal(interpret("0xdeadbeef", spender).kind, "unknown");
});
test("phishing matching respects label boundaries and stale data remains effective", async () => {
  const domains = new Set(parseDomains(["bad.example"]));
  assert.equal(blockedHost("sub.bad.example", domains), true);
  assert.equal(blockedHost("notbad.example", domains), false);
  const protection = new Phishing(
    { get: async () => undefined, set: async () => {}, remove: async () => {} },
    async () => ({
      updatedAt: Date.now() - 90_000_000,
      domains: ["bad.example"],
    }),
  );
  assert.equal((await protection.view()).status, "stale");
  await assert.rejects(protection.check("https://bad.example"), /blocked/);
  assert.throws(() => parseDomains(["https://bad.example/path"]));
});
