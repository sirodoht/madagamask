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
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  maxUint256,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { client, type Network, rpc } from "../../src/core/networks.ts";

let context: BrowserContext;
let profile: string;
let popup: Page;
let extensionId: string;
const startupSamples: number[] = [];

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
  const started = performance.now();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popup.getByRole("heading", { name: "Ethereum wallet" }),
  ).toBeVisible();
  startupSamples.push(Math.round(performance.now() - started));
});
test.afterAll(async () => {
  const sorted = [...startupSamples].sort((a, b) => a - b);
  await writeFile(
    `artifacts/startup-${process.env.MADAGAMASK_BROWSER ?? "chromium"}.json`,
    JSON.stringify(
      {
        measurement:
          "popup navigation to ready onboarding; new profiles, worker already loaded",
        samplesMs: startupSamples,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        maxMs: Math.max(...sorted),
      },
      null,
      2,
    ),
  );
});

test.afterEach(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test("production popup loads, connects, and opens the full view", async () => {
  await expect(
    popup.getByRole("heading", { name: "Ethereum wallet" }),
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

test("locked wallet session storage contains only the heartbeat timestamp", async () => {
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
  await popup.evaluate(async () => {
    document.documentElement.style.fontSize = "16px";
    await chrome.runtime.sendMessage({
      version: 1,
      type: "app:command",
      action: "import",
      params: {
        password: "disposable-settings-password",
        phrase: "test test test test test test test test test test test junk",
      },
    });
    await chrome.runtime.sendMessage({
      version: 1,
      type: "app:command",
      action: "addAccount",
      params: {
        name: "Imported",
        privateKey: `0x${"11".repeat(32)}`,
      },
    });
  });
  await popup.reload();
  for (const width of [320, 380]) {
    await popup.setViewportSize({ width, height: 600 });
    const header = await popup.locator(".brand-row").boundingBox();
    const lock = await popup
      .getByRole("button", { name: "Lock wallet" })
      .boundingBox();
    await popup.getByRole("button", { name: "Settings", exact: true }).click();
    expect(await popup.locator(".brand-row").boundingBox()).toEqual(header);
    expect(
      await popup.getByRole("button", { name: "Lock wallet" }).boundingBox(),
    ).toEqual(lock);
    expect(
      await popup.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const name of [
      "Back up wallet",
      "Rename wallet",
      "Rename account",
      "Add wallet",
      "Add account",
    ])
      await expect(
        popup.getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    await expect(popup.locator(".settings-account")).toHaveCount(0);
    await expect(
      popup.getByRole("button", { name: "Reset all wallets", exact: true }),
    ).toBeVisible();
    if (width === 380)
      await popup.screenshot({
        path: "artifacts/settings-chrome.png",
        fullPage: true,
      });
    if (width === 380) {
      for (const label of [
        "Connected sites",
        "Add or edit network",
        "Change password",
        "Auto-lock",
        "Reset all wallets",
      ]) {
        await popup.getByRole("button", { name: label, exact: true }).click();
        await popup.getByRole("button", { name: "Back", exact: true }).click();
        await expect(
          popup.getByRole("heading", { name: "Settings", exact: true }),
        ).toBeVisible();
      }
    }
    await popup.getByRole("button", { name: "Back", exact: true }).click();
  }
});

test("wallet screen selects accounts and renames without changing selection", async () => {
  await popup.evaluate(async () => {
    const command = (action: string, params: Record<string, unknown>) =>
      chrome.runtime.sendMessage({
        version: 1,
        type: "app:command",
        action,
        params,
      });
    await command("import", {
      password: "disposable-account-menu-password",
      phrase: "test test test test test test test test test test test junk",
    });
    await command("addAccount", {
      name: "Private account",
      privateKey: `0x${"22".repeat(32)}`,
    });
    await command("addAccount", {
      name: "Second account",
      walletId: "wallet-1",
    });
    await command("selectAccount", { index: 0 });
  });
  await popup.reload();
  await popup.setViewportSize({ width: 320, height: 600 });
  const selector = popup.getByRole("button", { name: "Account", exact: true });
  const address = await popup.locator(".address-copy").textContent();
  await popup.mouse.move(0, 0);
  const beforeHover = await selector.boundingBox();
  await expect(selector.locator(".account-name")).toBeVisible();
  await selector.hover();
  await expect(selector.locator(".account-switch-label")).toBeVisible();
  await expect(selector.locator(".account-switch-label")).toHaveText(
    "Switch account",
  );
  await expect(selector.locator(".account-name")).toBeHidden();
  expect(await selector.boundingBox()).toEqual(beforeHover);
  await popup.mouse.move(0, 0);
  await expect(selector.locator(".account-name")).toBeVisible();
  await expect(selector.locator(".account-switch-label")).toBeHidden();
  await popup.getByRole("button", { name: "Lock wallet", exact: true }).focus();
  await popup.keyboard.press("Shift+Tab");
  await expect(selector.locator(".account-switch-label")).toBeVisible();
  expect(await selector.boundingBox()).toEqual(beforeHover);
  const header = await popup.locator(".brand-row").boundingBox();
  const addressBounds = await popup.locator("#account-address").boundingBox();
  await popup.keyboard.press("Enter");
  expect(await popup.locator(".brand-row").boundingBox()).toEqual(header);
  expect(await popup.locator("#account-address").boundingBox()).toEqual(
    addressBounds,
  );
  await expect(popup.locator(".brand")).toBeHidden();
  await expect(popup.locator("h1")).toHaveCount(0);
  expect(
    await selector.evaluate((el) => getComputedStyle(el, "::after").content),
  ).toBe("none");
  await expect(popup.locator('#app[aria-label="Accounts"]')).toBeVisible();
  await expect(
    popup.getByRole("button", {
      name: "Select account Account 1",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(popup.locator("[popover]:popover-open")).toHaveCount(0);
  await popup.locator("body").click({ position: { x: 4, y: 4 } });
  await expect(popup.locator('#app[aria-label="Accounts"]')).toBeVisible();
  await popup
    .getByRole("button", {
      name: "Account actions for Private account",
      exact: true,
    })
    .click();
  await popup
    .getByRole("menuitem", { name: "Rename account", exact: true })
    .click();
  await popup.getByLabel("Account name").fill("gox");
  await popup.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    popup.getByRole("button", { name: "Select account gox", exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByRole("button", {
      name: "Select account Account 1",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await popup
    .getByRole("button", { name: "Wallet actions for Wallet 1", exact: true })
    .click();
  await expect(
    popup.getByRole("menuitem", { name: "Rename wallet", exact: true }),
  ).toBeFocused();
  await popup.keyboard.press("ArrowDown");
  await expect(
    popup.getByRole("menuitem", { name: "Back up wallet", exact: true }),
  ).toBeFocused();
  await popup.keyboard.press("ArrowDown");
  await expect(
    popup.getByRole("menuitem", { name: "Add account", exact: true }),
  ).toBeFocused();
  await popup.keyboard.press("Escape");
  const walletActions = popup.getByRole("button", {
    name: "Wallet actions for Wallet 1",
    exact: true,
  });
  await expect(walletActions).toBeFocused();
  await walletActions.click();
  await expect(walletActions).toHaveAttribute("aria-expanded", "true");
  await walletActions.click();
  await expect(popup.locator("[popover]:popover-open")).toHaveCount(0);
  await expect(walletActions).toHaveAttribute("aria-expanded", "false");
  await walletActions.click();
  const menuBounds = await popup
    .getByRole("menu", { name: "Wallet actions for Wallet 1", exact: true })
    .boundingBox();
  expect(menuBounds?.width).toBeLessThanOrEqual(192);
  expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(
    320,
  );
  await popup.screenshot({
    path: "artifacts/wallet-dots-menu-chrome.png",
    fullPage: true,
  });
  await popup.locator("body").click({ position: { x: 4, y: 4 } });
  await expect(popup.locator("[popover]:popover-open")).toHaveCount(0);
  await walletActions.click();
  await popup
    .getByRole("menuitem", { name: "Rename wallet", exact: true })
    .click();
  await popup.getByLabel("Wallet name").fill("Personal");
  await popup.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    popup.getByRole("region", { name: "Personal", exact: true }),
  ).toBeVisible();
  await popup
    .getByRole("button", {
      name: "Account actions for Second account",
      exact: true,
    })
    .click();
  await popup
    .getByRole("menuitem", { name: "Rename account", exact: true })
    .click();
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect(popup.locator('#app[aria-label="Accounts"]')).toBeVisible();
  expect(
    await popup.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect(selector).toBeFocused();
  await expect(popup.locator(".address-copy")).toHaveText(address ?? "");
  await selector.click();
  const second = popup.getByRole("button", {
    name: "Select account Second account",
    exact: true,
  });
  await second.focus();
  await popup.keyboard.press("Enter");
  await expect(selector.locator(".account-name")).toHaveText("Second account");
  await expect(popup.locator(".address-copy")).not.toHaveText(address ?? "");
  await popup.reload();
  await selector.click();
  await expect(
    popup.getByRole("region", { name: "Personal", exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByRole("button", { name: "Select account gox", exact: true }),
  ).toBeVisible();
  await popup.screenshot({
    path: "artifacts/wallet-screen-chrome.png",
    fullPage: true,
  });
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
  await expect(popup.getByLabel("Account", { exact: true })).toBeVisible();
  const address = await popup.locator(".address").textContent();
  await popup.getByRole("button", { name: "Account", exact: true }).click();
  await popup
    .getByRole("button", { name: "Wallet actions for Wallet 1", exact: true })
    .click();
  await popup
    .getByRole("menuitem", { name: "Back up wallet", exact: true })
    .click();
  await popup
    .getByLabel("Password", { exact: true })
    .fill("a-disposable-test-password");
  await popup.getByRole("button", { name: "Reveal backup" }).click();
  const phrase = await popup.locator(".secret").textContent();
  expect(phrase?.split(" ")).toHaveLength(12);
  await popup.getByLabel("Confirm your recovery phrase").fill(phrase ?? "");
  await popup.getByRole("button", { name: "Confirm backup" }).click();
  await expect(popup.getByLabel("Account", { exact: true })).toBeVisible();
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
    // Inspect the actual extension content-script world, not just the page.
    const cdp = await context.newCDPSession(site);
    const executionContexts: number[] = [];
    cdp.on("Runtime.executionContextCreated", ({ context }) => {
      executionContexts.push(context.id);
    });
    await cdp.send("Runtime.enable");
    let checkedContentWorld = false;
    for (const contextId of executionContexts) {
      const identity = await cdp.send("Runtime.evaluate", {
        contextId,
        expression: "globalThis.chrome?.runtime?.id",
        returnByValue: true,
      });
      if (identity.result.value !== extensionId) continue;
      const access = await cdp.send("Runtime.evaluate", {
        contextId,
        expression:
          "(async () => { try { await chrome.storage.session.get('unlockSession'); return true; } catch { return false; } })()",
        awaitPromise: true,
        returnByValue: true,
      });
      expect(access.result.value).toBe(false);
      checkedContentWorld = true;
    }
    expect(checkedContentWorld).toBe(true);
    await cdp.detach();
    expect(
      await popup.evaluate(async () => {
        const session = (await chrome.storage.session.get("unlockSession"))
          .unlockSession as { key: string } | undefined;
        const disk = JSON.stringify(await chrome.storage.local.get(null));
        return !!session?.key && !disk.includes(session.key);
      }),
    ).toBe(true);
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
    await expect(popup.getByLabel("Account", { exact: true })).toBeVisible();
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
      .getByRole("button", { name: "Import mnemonic", exact: true })
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
    const networkProgress = await popup
      .getByRole("status")
      .evaluateHandle((element) => {
        const messages: string[] = [];
        const observer = new MutationObserver(() =>
          messages.push(element.textContent ?? ""),
        );
        observer.observe(element, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        return { messages, observer };
      });
    await popup.getByLabel("Network", { exact: true }).selectOption("31337");
    await expect(popup.locator(".balance")).toHaveText("10000 ETH");
    expect(
      await networkProgress.evaluate(({ messages, observer }) => {
        observer.disconnect();
        return messages;
      }),
    ).not.toContain("Working…");
    await networkProgress.dispose();
    for (const width of [320, 380]) {
      await popup.setViewportSize({ width, height: 600 });
      expect(
        await popup.evaluate(() => ({
          fitsHeight: document.documentElement.scrollHeight <= innerHeight,
          fitsWidth: document.documentElement.scrollWidth <= innerWidth,
        })),
      ).toMatchObject({ fitsHeight: true, fitsWidth: true });
    }
    await popup.setViewportSize({ width: 380, height: 600 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const copiedAddress = await popup.locator(".address-copy").textContent();
    const beforeCopy = await popup.locator(".shell").boundingBox();
    await popup.locator(".address-copy").click();
    await expect(popup.locator(".address-feedback")).toHaveText(
      "Address copied ✓",
    );
    await expect(popup.getByRole("status")).toHaveText("");
    expect(await popup.locator(".shell").boundingBox()).toEqual(beforeCopy);
    expect(await popup.evaluate(() => navigator.clipboard.readText())).toBe(
      copiedAddress,
    );
    await expect(popup.locator(".address-feedback")).toHaveText("");
    await expect(popup.locator(".address-value")).toBeVisible();
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

    const dappServer = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(
        "<!doctype html><title>Allowance test</title><h1>Disposable dapp</h1>",
      );
    });
    await new Promise<void>((resolve) =>
      dappServer.listen(0, "127.0.0.1", resolve),
    );
    const bound = dappServer.address();
    if (!bound || typeof bound === "string") throw new Error("No dapp port");
    try {
      const site = await context.newPage();
      const origin = `http://127.0.0.1:${bound.port}`;
      await site.goto(origin);
      const request = (args: { method: string; params?: unknown[] }) =>
        site.evaluate(
          (args) =>
            (
              window as unknown as {
                ethereum: {
                  request: (args: {
                    method: string;
                    params?: unknown[];
                  }) => Promise<unknown>;
                };
              }
            ).ethereum.request(args),
          args,
        );
      const show = async () => {
        await expect
          .poll(() =>
            popup.evaluate(
              async () =>
                (
                  await chrome.runtime.sendMessage({
                    version: 1,
                    type: "app:command",
                    action: "state",
                    params: {},
                  })
                ).value.approvals.length,
            ),
          )
          .toBe(1);
        await popup.reload();
        await popup
          .getByRole("button", { name: `Review ${origin}`, exact: true })
          .click();
      };
      const connecting = request({ method: "eth_requestAccounts" });
      connecting.catch(() => {});
      await show();
      await popup.getByRole("button", { name: "Connect", exact: true }).click();
      await connecting;
      const spender = "0x0000000000000000000000000000000000005678";
      const approving = request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account.address,
            to: receipt.contractAddress,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [spender, maxUint256],
            }),
          },
        ],
      });
      approving.catch(() => {});
      await show();
      await expect(popup.getByText(/UNLIMITED tokens/)).toBeVisible();
      await popup
        .getByLabel("Allowance in token base units", { exact: true })
        .fill("7");
      await popup
        .getByRole("button", { name: "Update allowance", exact: true })
        .click();
      await expect(popup.getByText(/spend 7 base units/)).toBeVisible();
      await popup
        .getByRole("button", { name: "Approve request", exact: true })
        .click();
      const approvedHash = (await approving) as Hex;
      const approvedReceipt = await client(network).waitForTransactionReceipt({
        hash: approvedHash,
        pollingInterval: 50,
      });
      expect(approvedReceipt.status).toBe("success");
      expect(
        await client(network).readContract({
          address: receipt.contractAddress as Hex,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, spender],
        }),
      ).toBe(7n);
    } finally {
      await new Promise<void>((resolve) => dappServer.close(() => resolve()));
    }
  } finally {
    anvil.kill("SIGTERM");
    await delay(100);
  }
});

test("external EIP-6963 demo interoperability", async () => {
  test.skip(
    process.env.MADAGAMASK_EXTERNAL_DAPP !== "1",
    "Explicit external-site validation only",
  );
  test.setTimeout(45_000);
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
  site.on("console", (m) => {
    if (m.type() === "error") console.log(m.text());
  });
  site.on("pageerror", (error) => console.log(error.message));
  await site.goto("https://eip6963.org/", { waitUntil: "domcontentloaded" });
  await expect(site.getByText("Madagamask", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await site.getByRole("button", { name: "Connect", exact: true }).click();
  await expect
    .poll(
      () =>
        popup.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({
            version: 1,
            type: "app:command",
            action: "state",
            params: {},
          });
          return response.value.approvals.length;
        }),
      { timeout: 15_000 },
    )
    .toBe(1);
  await popup.reload();
  await popup
    .getByRole("button", { name: "Review https://eip6963.org", exact: true })
    .click();
  await popup.getByRole("button", { name: "Connect", exact: true }).click();
  console.log(
    "Connected external demo",
    (await site.locator("body").textContent())?.slice(-2000),
  );
  await expect
    .poll(() =>
      site.evaluate(async () => {
        const provider = (
          window as unknown as {
            ethereum: {
              request: (request: { method: string }) => Promise<unknown>;
            };
          }
        ).ethereum;
        return provider.request({ method: "eth_accounts" });
      }),
    )
    .toEqual(["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]);
  await site.screenshot({
    path: "artifacts/external-demo.png",
    fullPage: true,
  });
});

test("wallet screen groups sources and returns from wallet actions", async () => {
  const password = "disposable-multi-wallet-password";
  const seed = "000102030405060708090a0b0c0d0e0f";
  await popup
    .getByRole("button", { name: "Import wallet", exact: true })
    .click();
  await popup.getByRole("button", { name: "Import seed", exact: true }).click();
  await popup.getByLabel("Seed (hexadecimal)").fill(seed);
  await popup.getByLabel("Password", { exact: true }).fill(password);
  await popup.getByLabel("Confirm password", { exact: true }).fill(password);
  await popup.getByRole("button", { name: "Import test wallet" }).click();
  const selector = popup.getByRole("button", { name: "Account", exact: true });
  await selector.click();
  await popup
    .getByRole("button", { name: "Wallet actions for Wallet 1", exact: true })
    .click();
  await popup
    .getByRole("menuitem", { name: "Rename wallet", exact: true })
    .click();
  await popup.getByLabel("Wallet name").fill("Trading");
  await popup.getByRole("button", { name: "Save name", exact: true }).click();
  await popup
    .getByRole("button", { name: "Wallet actions for Trading", exact: true })
    .click();
  await popup
    .getByRole("menuitem", { name: "Add account", exact: true })
    .click();
  await popup.getByLabel("Account name").fill("Trading two");
  await popup.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(selector.locator(".account-name")).toHaveText("Trading two");
  const importWallet = async (
    name: string,
    kind: string,
    label: string,
    secret: string,
  ) => {
    await selector.click();
    await popup
      .getByRole("button", { name: "+ Add wallet", exact: true })
      .click();
    await popup
      .getByRole("button", { name: `Import ${kind}`, exact: true })
      .click();
    await popup.getByLabel("Wallet name").fill(name);
    await popup.getByLabel(label, { exact: true }).fill(secret);
    await popup
      .getByRole("button", { name: "Import wallet", exact: true })
      .click();
    await expect(selector.locator(".account-name")).toHaveText("Account 1");
  };
  await importWallet(
    "Personal",
    "mnemonic",
    "Recovery phrase",
    "test test test test test test test test test test test junk",
  );
  await importWallet(
    "gox",
    "private key",
    "Private key",
    `0x${"33".repeat(32)}`,
  );
  await popup.setViewportSize({ width: 380, height: 600 });
  await selector.click();
  for (const [name, kind, count] of [
    ["Trading", "Seed", 2],
    ["Personal", "Mnemonic", 1],
    ["gox", "Private key", 1],
  ] as const) {
    const group = popup.getByRole("region", { name, exact: true });
    const source = group.getByRole("img", { name: kind, exact: true });
    await expect(source).toBeVisible();
    await expect(source.locator("svg")).toHaveCount(1);
    const explanation = source.getByRole("tooltip", { includeHidden: true });
    await expect(explanation).toBeHidden();
    await source.hover();
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText(
      kind === "Mnemonic"
        ? "recovery words"
        : kind === "Seed"
          ? "root seed data"
          : "single key",
    );
    await popup.mouse.move(0, 0);
    await source.focus();
    await expect(explanation).toBeVisible();
    const tipBounds = await explanation.boundingBox();
    expect(tipBounds?.x).toBeGreaterThanOrEqual(0);
    expect((tipBounds?.x ?? 0) + (tipBounds?.width ?? 0)).toBeLessThanOrEqual(
      380,
    );
    await expect(group.locator(".account-row > .account-option")).toHaveCount(
      count,
    );
    await group
      .getByRole("button", { name: `Wallet actions for ${name}`, exact: true })
      .click();
    await expect(
      popup.getByRole("menuitem", { name: "Add account", exact: true }),
    ).toHaveCount(kind === "Private key" ? 0 : 1);
    await popup.keyboard.press("Escape");
  }
  await popup.screenshot({
    path: "artifacts/wallet-screen-sources-chrome.png",
    fullPage: true,
  });
  await expect(
    popup.getByRole("button", { name: "Back up wallet", exact: true }),
  ).toHaveCount(0);
  await expect(
    popup.getByRole("button", { name: "Rename", exact: true }),
  ).toHaveCount(0);
  await popup
    .getByRole("button", { name: "Wallet actions for Trading", exact: true })
    .click();
  await popup
    .getByRole("menuitem", { name: "Back up wallet", exact: true })
    .click();
  await popup.getByLabel("Password", { exact: true }).fill(password);
  await popup
    .getByRole("button", { name: "Reveal backup", exact: true })
    .click();
  await expect(popup.locator(".secret")).toHaveText(`0x${seed}`);
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect(popup.locator(".secret")).toHaveCount(0);
  await expect(popup.locator('#app[aria-label="Accounts"]')).toBeVisible();
  await popup
    .getByRole("button", { name: "+ Add wallet", exact: true })
    .click();
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect(popup.locator('#app[aria-label="Accounts"]')).toBeVisible();
  await popup
    .getByRole("button", { name: "+ Add wallet", exact: true })
    .click();
  await popup
    .getByRole("button", { name: "Create wallet", exact: true })
    .click();
  await popup.getByLabel("Wallet name").fill("Fresh");
  await popup
    .getByRole("button", { name: "Create wallet", exact: true })
    .click();
  await expect(selector.locator(".account-name")).toHaveText("Account 1");
  await selector.click();
  await popup
    .getByRole("button", { name: "Wallet actions for Fresh", exact: true })
    .click();
  await popup
    .getByRole("menuitem", { name: "Back up wallet", exact: true })
    .click();
  await popup.getByLabel("Password", { exact: true }).fill(password);
  await popup
    .getByRole("button", { name: "Reveal backup", exact: true })
    .click();
  const freshPhrase = await popup.locator(".secret").textContent();
  expect(freshPhrase?.split(" ")).toHaveLength(12);
  await popup
    .getByLabel("Confirm your recovery phrase")
    .fill(freshPhrase ?? "");
  await popup
    .getByRole("button", { name: "Confirm backup", exact: true })
    .click();
  await expect(selector).toBeVisible();
});
