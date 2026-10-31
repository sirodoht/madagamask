import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { launch, type Wallet } from "./harness.ts";

let wallet: Wallet;

beforeEach(async () => {
  wallet = await launch();
});
afterEach(async () => {
  await wallet.quit();
});

test("creates a wallet through the production popup", async () => {
  await wallet.createWallet();
  assert.match(await wallet.text(".address-value"), /^0x[0-9a-fA-F]{40}$/);
});
