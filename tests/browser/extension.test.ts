import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { createWalletClient, custom, erc20Abi, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { client, type Network, rpc } from "../../src/core/networks.ts";

let context: BrowserContext;
let profile: string;
let popup: Page;
let extensionId: string;

async function launchContext() {
  const path = resolve("dist/chrome");
  const stable = process.env.MADAGAMASK_BROWSER === "chrome";
  context = await chromium.launchPersistentContext(profile, {
    channel: stable ? "chrome" : "chromium",
    ...(process.env.MADAGAMASK_CHROME_PATH
      ? { executablePath: process.env.MADAGAMASK_CHROME_PATH }
      : {}),
    headless: true,
    ignoreDefaultArgs: stable ? ["--disable-extensions"] : [],
    args: stable
      ? ["--enable-unsafe-extension-debugging"]
      : [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  if (stable) {
    const browser = context.browser();
    if (!browser) throw new Error("No browser session");
    const cdp = await browser.newBrowserCDPSession();
    const result = await cdp.send("Extensions.loadUnpacked", { path });
    extensionId = result.id;
    await cdp.detach();
  } else {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    extensionId = new URL(worker.url()).host;
  }
  await writeFile(
    `artifacts/browser-${stable ? "chrome" : "chromium"}.json`,
    JSON.stringify(
      {
        browser: context.browser()?.version(),
        channel: stable ? "chrome" : "chromium",
        ...(process.env.MADAGAMASK_CHROME_PATH
          ? { executablePath: process.env.MADAGAMASK_CHROME_PATH }
          : {}),
        date: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "madagamask-browser-"));
  await launchContext();
  popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
});

test.afterEach(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test("production popup loads, connects, and opens the full view", async () => {
  await expect(
    popup.getByRole("heading", { name: "A little simpler. All yours." }),
  ).toBeVisible();
  await expect(popup.getByRole("status")).toHaveText("");
  await expect(popup.getByRole("button", { name: "Try again" })).toBeHidden();
  await popup.screenshot({
    path: "artifacts/popup-chromium.png",
    fullPage: true,
  });
  const opened = context.waitForEvent("page");
  await popup.getByRole("button", { name: "Open in a tab" }).click();
  const tab = await opened;
  await expect(tab).toHaveURL(`chrome-extension://${extensionId}/popup.html`);
  await expect(tab.getByRole("status")).toHaveText("");
});

test("malformed messages and role escalation fail closed", async () => {
  const responses = await popup.evaluate(async () => {
    return Promise.all([
      chrome.runtime.sendMessage({ version: 2, type: "app:get-status" }),
      chrome.runtime.sendMessage({ version: 1, type: "content:hello" }),
      chrome.runtime.sendMessage({
        version: 1,
        type: "app:get-status",
        sender: "trusted",
      }),
    ]);
  });
  expect(responses).toEqual([
    { ok: false, error: "INVALID_REQUEST" },
    { ok: false, error: "UNAUTHORIZED" },
    { ok: false, error: "INVALID_REQUEST" },
  ]);
});

test("heartbeat stores only a timestamp and does not persist wallet state", async () => {
  await expect
    .poll(async () =>
      Object.keys(await popup.evaluate(() => chrome.storage.session.get(null))),
    )
    .toEqual(["heartbeatAt"]);
  const initial = await popup.evaluate(() => chrome.storage.session.get(null));
  expect(Object.keys(initial)).toEqual(["heartbeatAt"]);
  expect(typeof initial.heartbeatAt).toBe("number");
  await expect
    .poll(() => popup.evaluate(() => chrome.storage.session.get("heartbeatAt")))
    .not.toEqual(initial);
  expect(await popup.evaluate(() => chrome.storage.local.get(null))).toEqual(
    {},
  );
});

test("popup preserves layout and keyboard access at narrow widths and enlarged text", async () => {
  for (const width of [320, 380, 800]) {
    await popup.setViewportSize({ width, height: 700 });
    await popup.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });
    expect(
      await popup.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await popup.getByRole("button", { name: "Open in a tab" }).focus();
    await expect(
      popup.getByRole("button", { name: "Open in a tab" }),
    ).toBeFocused();
  }
});

test("create, back up, lock, and restore a wallet through the production UI", async () => {
  await popup
    .getByRole("button", { name: "Create wallet", exact: true })
    .click();
  await popup
    .getByLabel("Password", { exact: true })
    .fill("a-disposable-test-password");
  await popup
    .getByLabel("Confirm password", { exact: true })
    .fill("a-disposable-test-password");
  await popup.getByRole("button", { name: "Create test wallet" }).click();
  await expect(
    popup.getByRole("heading", { name: "Your wallet" }),
  ).toBeVisible();
  const address = await popup.locator(".address").textContent();
  await popup.getByRole("button", { name: "Back up now" }).click();
  await popup
    .getByLabel("Password", { exact: true })
    .fill("a-disposable-test-password");
  await popup.getByRole("button", { name: "Reveal backup" }).click();
  const phrase = await popup.locator(".secret").textContent();
  expect(phrase?.split(" ")).toHaveLength(12);
  await popup.getByLabel("Confirm your recovery phrase").fill(phrase ?? "");
  await popup.getByRole("button", { name: "Confirm backup" }).click();
  await expect(popup.getByRole("button", { name: "Back up now" })).toBeHidden();
  const stored = JSON.stringify(
    await popup.evaluate(() => chrome.storage.local.get(null)),
  );
  expect(stored).not.toContain(phrase);
  expect(stored).not.toContain("a-disposable-test-password");
  await popup.getByRole("button", { name: "Lock wallet" }).click();
  await expect(
    popup.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await popup
    .getByLabel("Password", { exact: true })
    .fill("a-disposable-test-password");
  await popup.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(popup.locator(".address")).toHaveText(address ?? "");
  await context.close();
  await launchContext();
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popup.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await popup
    .getByLabel("Password", { exact: true })
    .fill("a-disposable-test-password");
  await popup.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(popup.locator(".address")).toHaveText(address ?? "");
});

test("website provider discovers, connects, signs, and hides accounts after lock", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>Test site</title><h1>Test dapp</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  expect(bound && typeof bound !== "string").toBeTruthy();
  if (!bound || typeof bound === "string") throw new Error("No server port");
  try {
    await popup.evaluate(() =>
      chrome.runtime.sendMessage({
        version: 1,
        type: "app:command",
        action: "import",
        params: {
          password: "disposable-test-password",
          phrase: "test test test test test test test test test test test junk",
        },
      }),
    );
    const site = await context.newPage();
    await site.goto(`http://127.0.0.1:${bound.port}`);
    type Provider = {
      request: (request: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
    };
    await site.waitForFunction(
      () => !!(window as unknown as { ethereum?: Provider }).ethereum,
    );
    expect(
      await site.evaluate(() =>
        (window as unknown as { ethereum: Provider }).ethereum.request({
          method: "eth_accounts",
        }),
      ),
    ).toEqual([]);
    const connecting = site.evaluate(() =>
      (window as unknown as { ethereum: Provider }).ethereum.request({
        method: "eth_requestAccounts",
      }),
    );
    connecting.catch(() => {});
    await expect
      .poll(() =>
        popup.evaluate(async () => {
          const result = await chrome.runtime.sendMessage({
            version: 1,
            type: "app:command",
            action: "state",
            params: {},
          });
          return result.value.approvals.length;
        }),
      )
      .toBe(1);
    await popup.reload();
    await popup
      .getByRole("button", { name: `Review http://127.0.0.1:${bound.port}` })
      .click();
    await popup.getByRole("button", { name: "Connect", exact: true }).click();
    const accounts = (await connecting) as string[];
    expect(accounts).toHaveLength(1);
    const signing = site.evaluate(
      (account) =>
        (window as unknown as { ethereum: Provider }).ethereum.request({
          method: "personal_sign",
          params: ["0x68656c6c6f", account],
        }),
      accounts[0],
    );
    signing.catch(() => {});
    await expect
      .poll(() =>
        popup.evaluate(async () => {
          const result = await chrome.runtime.sendMessage({
            version: 1,
            type: "app:command",
            action: "state",
            params: {},
          });
          return result.value.approvals.length;
        }),
      )
      .toBe(1);
    await popup.reload();
    await popup
      .getByRole("button", { name: `Review http://127.0.0.1:${bound.port}` })
      .click();
    await popup.getByRole("button", { name: "Approve request" }).click();
    expect(await signing).toMatch(/^0x[0-9a-f]{130}$/i);
    await popup.getByRole("button", { name: "Lock wallet" }).click();
    expect(
      await site.evaluate(() =>
        (window as unknown as { ethereum: Provider }).ethereum.request({
          method: "eth_accounts",
        }),
      ),
    ).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("public Sepolia and Base Sepolia balances keep their network context", async () => {
  test.skip(
    process.env.MADAGAMASK_PUBLIC_RPC !== "1",
    "Explicit network validation only",
  );
  test.setTimeout(60_000);
  const created = await popup.evaluate(() =>
    chrome.runtime.sendMessage({
      version: 1,
      type: "app:command",
      action: "create",
      params: { password: "disposable-public-rpc-password" },
    }),
  );
  expect(created.ok).toBe(true);
  await popup.reload();
  for (const chainId of [11155111, 84532]) {
    await popup
      .getByLabel("Network", { exact: true })
      .selectOption(String(chainId));
    await expect(
      popup.getByRole("heading", { name: "Your wallet" }),
    ).toBeVisible();
    await popup
      .getByRole("button", { name: "Refresh balance", exact: true })
      .click();
    await expect(popup.locator(".balance")).toHaveText(/^\d+(\.\d+)? ETH$/, {
      timeout: 30_000,
    });
    await popup.getByRole("button", { name: "Receive", exact: true }).click();
    await expect(popup.getByText(new RegExp(`chain ${chainId}`))).toBeVisible();
    await expect(popup.getByRole("img")).toBeVisible();
    await popup.getByRole("button", { name: "Back", exact: true }).click();
  }
});

test("production UI imports, sends native assets, imports a token, and sends tokens on a local chain", async () => {
  test.setTimeout(60_000);
  const portServer = createServer();
  await new Promise<void>((resolve) =>
    portServer.listen(0, "127.0.0.1", resolve),
  );
  const bound = portServer.address();
  if (!bound || typeof bound === "string") throw new Error("No port");
  await new Promise<void>((resolve) => portServer.close(() => resolve()));
  const network: Network = {
    id: 31337,
    name: "Local test chain",
    symbol: "ETH",
    rpc: `http://127.0.0.1:${bound.port}`,
  };
  const anvil = spawn("anvil", ["--port", String(bound.port), "--silent"], {
    stdio: "ignore",
  });
  try {
    await expect
      .poll(async () => {
        try {
          await rpc(network, "eth_chainId");
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
    await popup
      .getByRole("button", { name: "Import wallet", exact: true })
      .click();
    await popup
      .getByLabel("Recovery phrase", { exact: true })
      .fill("test test test test test test test test test test test junk");
    await popup
      .getByLabel("Password", { exact: true })
      .fill("disposable-test-password");
    await popup
      .getByLabel("Confirm password", { exact: true })
      .fill("disposable-test-password");
    await popup.getByRole("button", { name: "Import test wallet" }).click();
    await popup.getByRole("button", { name: "Settings", exact: true }).click();
    await popup.getByRole("button", { name: "Add or edit network" }).click();
    for (const [label, value] of [
      ["Chain ID", "31337"],
      ["Network name", network.name],
      ["Currency symbol", "ETH"],
      ["RPC URL", network.rpc],
    ] as const)
      await popup.getByLabel(label, { exact: true }).fill(value);
    await popup
      .getByRole("button", { name: "Verify and save network" })
      .click();
    await popup.getByLabel("Network", { exact: true }).selectOption("31337");
    await popup
      .getByRole("button", { name: "Refresh balance", exact: true })
      .click();
    await expect(popup.locator(".balance")).toHaveText("10000 ETH");
    await popup.screenshot({
      path: "artifacts/wallet-home.png",
      fullPage: true,
    });
    await popup.getByRole("button", { name: "Send", exact: true }).click();
    await popup
      .getByLabel("Recipient address", { exact: true })
      .fill("0x0000000000000000000000000000000000001234");
    await popup.getByLabel("Amount", { exact: true }).fill("1");
    await popup
      .getByRole("button", { name: "Review transaction", exact: true })
      .click();
    await expect(
      popup.getByRole("heading", { name: "Review transaction" }),
    ).toBeVisible();
    await popup.screenshot({
      path: "artifacts/transaction-review.png",
      fullPage: true,
    });
    await popup.getByRole("button", { name: "Confirm and send" }).click();
    await expect(
      popup.getByRole("heading", { name: "Transaction submitted" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        client(network).getBalance({
          address: "0x0000000000000000000000000000000000001234",
        }),
      )
      .toBe(10n ** 18n);
    await popup.getByRole("button", { name: "Back", exact: true }).click();
    await popup.getByRole("button", { name: "Activity", exact: true }).click();
    await popup.getByRole("button", { name: "Refresh activity" }).click();
    await expect(
      popup.getByRole("heading", { name: "confirmed", exact: true }),
    ).toBeVisible();
    await popup.getByRole("button", { name: "Back", exact: true }).click();
    const fixture = JSON.parse(
      await readFile("tests/fixtures/test-token.json", "utf8"),
    );
    const account = mnemonicToAccount(
      "test test test test test test test test test test test junk",
    );
    const deployer = createWalletClient({
      account,
      chain: client(network).chain,
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
    if (!receipt.contractAddress) throw new Error("Token deployment failed");
    await popup.getByRole("button", { name: "Tokens", exact: true }).click();
    await popup
      .getByRole("button", { name: "Import token", exact: true })
      .click();
    await popup
      .getByLabel("Token contract address", { exact: true })
      .fill(receipt.contractAddress);
    await popup.getByRole("button", { name: "Verify and import" }).click();
    await expect(
      popup.getByRole("heading", { name: "Madagamask Test Token (MTEST)" }),
    ).toBeVisible();
    await popup.getByRole("button", { name: "Refresh token balance" }).click();
    await expect(popup.getByText("1000 MTEST", { exact: true })).toBeVisible();
    await popup
      .getByRole("button", { name: "Send MTEST", exact: true })
      .click();
    await popup
      .getByLabel("Recipient address", { exact: true })
      .fill("0x0000000000000000000000000000000000005678");
    await popup.getByLabel("Token amount", { exact: true }).fill("1.234567");
    await popup.getByRole("button", { name: "Review token transfer" }).click();
    await expect(popup.getByText(/1234567 base units/)).toBeVisible();
    await popup.getByRole("button", { name: "Confirm and send" }).click();
    await expect(
      popup.getByRole("heading", { name: "Transaction submitted" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        client(network).readContract({
          address: receipt.contractAddress as Hex,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: ["0x0000000000000000000000000000000000005678"],
        }),
      )
      .toBe(1234567n);
  } finally {
    anvil.kill("SIGTERM");
    await delay(100);
  }
});

test("external EIP-6963 test dapp interoperability", async () => {
  test.skip(
    process.env.MADAGAMASK_EXTERNAL_DAPP !== "1",
    "Explicit external-site validation only",
  );
  test.setTimeout(60_000);
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({
      version: 1,
      type: "app:command",
      action: "import",
      params: {
        password: "disposable-test-password",
        phrase: "test test test test test test test test test test test junk",
      },
    }),
  );
  const site = await context.newPage();
  await site.goto("https://metamask.github.io/test-dapp/", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    site.getByRole("heading", { name: "E2E Test Dapp" }),
  ).toBeVisible();
  console.log(
    "External test controls:",
    await site.getByRole("button").allTextContents(),
  );
  await site.screenshot({
    path: "artifacts/external-test-dapp.png",
    fullPage: true,
  });
});
