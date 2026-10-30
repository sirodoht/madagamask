import { mkdtemp, rm } from "node:fs/promises";
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
  await expect(popup.getByRole("status")).toHaveText(
    "Your preview is ready to explore.",
  );
  await expect(popup.getByRole("button", { name: "Try again" })).toBeHidden();
  await popup.screenshot({
    path: "artifacts/popup-chromium.png",
    fullPage: true,
  });
  const opened = context.waitForEvent("page");
  await popup.getByRole("button", { name: "Open in a tab" }).click();
  const tab = await opened;
  await expect(tab).toHaveURL(`chrome-extension://${extensionId}/popup.html`);
  await expect(tab.getByRole("status")).toHaveText(
    "Your preview is ready to explore.",
  );
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
