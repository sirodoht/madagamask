import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { By } from "selenium-webdriver";
import { recoverMessageAddress } from "viem";
import {
  ADDRESS,
  chainCall,
  launch,
  PASSWORD,
  PHRASE,
  startChain,
  startSite,
  stopSite,
  type Wallet,
} from "./harness.ts";

const RECIPIENT = "0x0000000000000000000000000000000000001234";
let wallet: Wallet;

beforeEach(async () => {
  wallet = await launch();
});
afterEach(async () => {
  await wallet.quit();
});

async function receiptValue(rpc: string, hash: string) {
  const receipt = (await chainCall(rpc, "eth_getTransactionReceipt", [
    hash,
  ])) as {
    status: string;
  };
  assert.equal(receipt.status, "0x1");
}

test("creates a wallet and stores only ciphertext in the extension database", async () => {
  await wallet.createWallet();
  assert.match(await wallet.text(".address-value"), /^0x[0-9a-fA-F]{40}$/);
  const database = await wallet.database();
  assert.ok(database.vault);
  assert.equal(JSON.stringify(database).includes(PASSWORD), false);
  assert.deepEqual(
    await wallet.driver.executeAsyncScript(
      "chrome.storage.local.get(null).then(arguments[arguments.length - 1])",
    ),
    {},
  );
});

test("restores the standard address from a recovery phrase", async () => {
  await wallet.importWallet();
  assert.equal(await wallet.text(".address-value"), ADDRESS);
  assert.equal(JSON.stringify(await wallet.database()).includes(PHRASE), false);
});

test("locks, rejects a wrong password, and unlocks", async () => {
  await wallet.importWallet();
  await wallet.click("Lock wallet");
  await wallet.visible(By.xpath('//h1[normalize-space()="Welcome back"]'));
  await wallet.fill("Password", "not-the-right-password");
  await wallet.click("Unlock");
  await wallet.visible(
    By.xpath(
      '//*[contains(., "incorrect") or contains(., "Incorrect") or contains(., "Wrong") or contains(., "wrong")]',
    ),
  );
  await wallet.fill("Password", PASSWORD);
  await wallet.click("Unlock");
  await wallet.field("Account");
  assert.equal(await wallet.text(".address-value"), ADDRESS);
});

test("sends a native transfer on a custom network", async () => {
  const { chain, url } = await startChain(4242);
  try {
    await wallet.importWallet();
    await wallet.addNetwork(url, 4242);
    assert.equal(await wallet.text(".balance-value"), "10000");
    await wallet.click("Send");
    await wallet.fill("Recipient address", RECIPIENT);
    await wallet.fill("Amount", "0.25");
    await wallet.click("Review transaction");
    assert.match(await wallet.text(".approval-notice"), /not been tested/);
    await wallet.click("Confirm and send");
    await wallet.click("View activity");
    await wallet.driver.wait(
      async () => (await wallet.text(".activity-status")) === "Confirmed",
      30_000,
    );
    assert.equal(
      await chainCall(url, "eth_getBalance", [RECIPIENT, "latest"]),
      "0x3782dace9d90000",
    );
  } finally {
    chain.kill("SIGTERM");
  }
});

test("site connects, signs, sends, and loses access after lock", async () => {
  const { chain, url } = await startChain();
  const { server, url: siteUrl } = await startSite();
  try {
    await wallet.importWallet();
    await wallet.addNetwork(url);
    const popup = await wallet.driver.getWindowHandle();
    await wallet.openSite(siteUrl);
    await wallet.request("eth_accounts");
    assert.deepEqual((await wallet.result<string[]>()).value, []);

    await wallet.request("eth_requestAccounts");
    await wallet.approve(() => wallet.click("Connect"));
    const accounts = (await wallet.result<string[]>()).value ?? [];
    assert.deepEqual(
      accounts.map((account) => account.toLowerCase()),
      [ADDRESS.toLowerCase()],
    );

    await wallet.request("personal_sign", ["0x68656c6c6f", accounts[0]]);
    await wallet.approve(() => wallet.click("Sign message"));
    const signature = (await wallet.result<`0x${string}`>()).value;
    assert.ok(signature);
    assert.equal(
      await recoverMessageAddress({ message: "hello", signature }),
      ADDRESS,
    );

    await wallet.request("personal_sign", ["0x00", accounts[0]]);
    await wallet.approve(() => wallet.click("Reject request"));
    assert.equal((await wallet.result()).code, 4001);

    await wallet.request("eth_sendTransaction", [
      { from: accounts[0], to: RECIPIENT, value: "0x38d7ea4c68000" },
    ]);
    await wallet.approve(() => wallet.click("Send transaction"));
    const hash = (await wallet.result<string>()).value;
    assert.ok(hash);
    await wallet.driver.wait(
      async () => !!(await chainCall(url, "eth_getTransactionReceipt", [hash])),
      15_000,
    );
    await receiptValue(url, hash);

    const site = await wallet.driver.getWindowHandle();
    await wallet.driver.switchTo().window(popup);
    await wallet.click("Lock wallet");
    await wallet.driver.switchTo().window(site);
    await wallet.request("eth_accounts");
    assert.deepEqual((await wallet.result<string[]>()).value, []);
  } finally {
    stopSite(server);
    chain.kill("SIGTERM");
  }
});

test("closing an approval window rejects the site's request", async () => {
  const { server, url } = await startSite();
  try {
    await wallet.importWallet();
    await wallet.openSite(url);
    await wallet.request("eth_requestAccounts");
    await wallet.approve(() => wallet.driver.close());
    assert.equal((await wallet.result()).code, 4001);
  } finally {
    stopSite(server);
  }
});

test("site discovers the wallet through EIP-6963", async () => {
  const { server, url } = await startSite();
  try {
    await wallet.importWallet();
    await wallet.openSite(url);
    const info = await wallet.driver.executeAsyncScript<{
      name: string;
      rdns: string;
    }>(`
      const done = arguments[arguments.length - 1];
      window.addEventListener("eip6963:announceProvider", (event) => done(event.detail.info));
      window.dispatchEvent(new Event("eip6963:requestProvider"));`);
    assert.equal(info.name, "Madagamask");
  } finally {
    stopSite(server);
  }
});

test("wallet screen stays inside the popup frame at its narrowest width", async () => {
  await wallet.importWallet();
  assert.equal(
    await wallet.driver.executeScript(
      "return getComputedStyle(document.body).fontFamily",
    ),
    "system-ui, sans-serif",
  );
  for (const width of [396, 320]) {
    const escaped = await wallet.driver.executeScript<string[]>(
      `const shell = document.querySelector(".shell");
      shell.style.width = arguments[0] + "px";
      shell.style.margin = "0";
      const edge = shell.getBoundingClientRect().right;
      return [...shell.querySelectorAll("*")]
        .filter((node) => node.getClientRects().length && node.getBoundingClientRect().right > edge + 0.5)
        .map((node) => node.className || node.tagName);`,
      width,
    );
    assert.deepEqual(escaped, []);
  }
});
