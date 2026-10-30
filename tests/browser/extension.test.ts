import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
} from "@playwright/test";

let context: BrowserContext;
let profile: string;
let popup: Page;
let extensionId: string;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "madagamask-browser-"));
  const path = resolve("dist/chrome");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
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
  const path = resolve("dist/chrome");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
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
