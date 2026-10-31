import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { download } from "geckodriver";
import {
  Builder,
  By,
  error,
  until,
  type WebDriver,
  type WebElement,
} from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const GECKODRIVER_VERSION = "0.37.1";
// SHA-256 of the extracted binary, from release archives matching GitHub's digests.
const GECKODRIVER_SHA256: Record<string, string> = {
  "darwin-arm64":
    "5d82307edc8549124bd4e7b6f275e1228e0a530e5abbfb294be3f310486561a4",
  "linux-arm64":
    "aed949129c68c12ff52db53eab4a260bc865b63080c050342fb8dc6dd6e684ee",
  "linux-x64":
    "f831b7e61454804e8a307edd951bf8a5f373efe3f718e75454a6485a51f6e39f",
};
const ADDON_ID = "madagamask@madagamask.local";
const TIMEOUT = 15_000;

export const PASSWORD = "a-disposable-test-password";
export const PHRASE =
  "test test test test test test test test test test test junk";
export const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// The wallet re-renders whole screens, so a found element can be replaced
// before Selenium uses it. Locating it again is the correct recovery.
async function retryStale<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (failure) {
      if (
        attempt >= 20 ||
        !(failure instanceof error.StaleElementReferenceError)
      )
        throw failure;
      await delay(100);
    }
  }
}

function xpathText(value: string) {
  return `"${value}"`;
}

export class Wallet {
  readonly driver: WebDriver;
  readonly popupUrl: string;
  constructor(driver: WebDriver, uuid: string) {
    this.driver = driver;
    this.popupUrl = `moz-extension://${uuid}/popup.html`;
  }
  async openPopup() {
    await this.driver.get(this.popupUrl);
  }
  async visible(locator: By): Promise<WebElement> {
    const element = await this.driver.wait(
      until.elementLocated(locator),
      TIMEOUT,
    );
    await this.driver.wait(until.elementIsVisible(element), TIMEOUT);
    return element;
  }
  button(name: string) {
    return this.visible(
      By.xpath(
        `//button[normalize-space()=${xpathText(name)} or @aria-label=${xpathText(name)}]`,
      ),
    );
  }
  click(name: string) {
    return retryStale(async () => (await this.button(name)).click());
  }
  field(label: string) {
    return this.visible(By.css(`[aria-label="${label}"]`));
  }
  fill(label: string, value: string) {
    return retryStale(async () => {
      const field = await this.field(label);
      await field.clear();
      await field.sendKeys(value);
    });
  }
  text(selector: string) {
    return retryStale(async () =>
      (await this.visible(By.css(selector))).getText(),
    );
  }
  async createWallet() {
    await this.openPopup();
    await this.click("Create wallet");
    await this.fill("Password", PASSWORD);
    await this.fill("Confirm password", PASSWORD);
    await this.click("Create wallet");
    return this.field("Account");
  }
  async importWallet(phrase = PHRASE) {
    await this.openPopup();
    await this.click("Import wallet");
    await this.click("Import mnemonic");
    await this.fill("Recovery phrase", phrase);
    await this.fill("Password", PASSWORD);
    await this.fill("Confirm password", PASSWORD);
    await this.click("Import wallet");
    await this.field("Account");
  }
  async addNetwork(rpc: string) {
    await this.click("Settings");
    await this.click("Add or edit network");
    await this.fill("Chain ID", "31337");
    await this.fill("Network name", "Local test chain");
    await this.fill("Currency symbol", "ETH");
    await this.fill("RPC URL", rpc);
    await this.click("Verify and save network");
    await this.visible(By.xpath('//h1[normalize-space()="Settings"]'));
    await this.click("Back");
    await retryStale(async () =>
      (await this.field("Network"))
        .findElement(By.css('option[value="31337"]'))
        .click(),
    );
    await this.driver.wait(
      async () => (await this.text(".balance-value")) === "10000",
      TIMEOUT,
      "Local chain balance did not load",
    );
  }
  // Starts a provider call on the current page without waiting for approval.
  async request(method: string, params: unknown[] = []) {
    await this.driver.executeScript(
      `window.walletResult = undefined;
      window.ethereum.request({ method: arguments[0], params: arguments[1] }).then(
        (value) => { window.walletResult = { value }; },
        (error) => { window.walletResult = { error: error.message, code: error.code }; },
      );`,
      method,
      params,
    );
  }
  async result<T>() {
    type Settled = { value?: T; error?: string; code?: number };
    const settled = await this.driver.wait(
      () =>
        this.driver.executeScript<Settled | undefined>(
          "return window.walletResult",
        ),
      TIMEOUT,
      "Provider request did not settle",
    );
    return settled as Settled;
  }
  // Runs one approval in the extension's own window, then returns to the site.
  async approve(action: () => Promise<void>) {
    const site = await this.driver.getWindowHandle();
    const before = await this.driver.getAllWindowHandles();
    const window = await this.driver.wait(
      async () =>
        (await this.driver.getAllWindowHandles()).find(
          (handle) => !before.includes(handle),
        ) ?? false,
      TIMEOUT,
      "Approval window did not open",
    );
    if (!window) throw new Error("Approval window did not open");
    await this.driver.switchTo().window(window);
    await action();
    await this.driver.wait(
      async () => !(await this.driver.getAllWindowHandles()).includes(window),
      TIMEOUT,
      "Approval window did not close",
    );
    await this.driver.switchTo().window(site);
  }
  async openSite(url: string) {
    await this.driver.switchTo().newWindow("tab");
    await this.driver.get(url);
    await this.driver.wait(
      () => this.driver.executeScript("return !!window.ethereum"),
      TIMEOUT,
      "Provider was not injected",
    );
  }
  database() {
    return this.driver.executeAsyncScript<Record<string, unknown>>(`
      const done = arguments[arguments.length - 1];
      const opened = indexedDB.open("madagamask");
      opened.onsuccess = () => {
        const state = {};
        const cursor = opened.result.transaction("state").objectStore("state").openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result) return done(state);
          state[cursor.result.key] = cursor.result.value;
          cursor.result.continue();
        };
      };`);
  }
  async quit() {
    await this.driver.quit();
  }
}

export async function startSite() {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>Test site</title><h1>Test dapp</h1>");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${port(server)}/` };
}

export function stopSite(server: Server) {
  server.closeAllConnections();
  server.close();
}

function port(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return address.port;
}

export async function startChain() {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const number = port(probe);
  await new Promise((done) => probe.close(done));
  const url = `http://127.0.0.1:${number}`;
  const chain: ChildProcess = spawn(
    "anvil",
    ["--port", String(number), "--silent"],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await chainCall(url, "eth_chainId").catch(() => undefined);
    if (ready) return { chain, url };
    await delay(100);
  }
  chain.kill("SIGTERM");
  throw new Error("Local chain did not start");
}

export async function chainCall(
  url: string,
  method: string,
  params: unknown[] = [],
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return ((await response.json()) as { result: unknown }).result;
}

async function verifiedDriver() {
  const platform = `${process.platform}-${process.arch}`;
  const expected = GECKODRIVER_SHA256[platform];
  if (!expected) throw new Error(`No geckodriver checksum for ${platform}`);
  const binary = await download(GECKODRIVER_VERSION);
  const actual = createHash("sha256")
    .update(await readFile(binary))
    .digest("hex");
  if (actual !== expected)
    throw new Error(`Geckodriver checksum mismatch at ${binary}: ${actual}`);
  return binary;
}

export async function launch() {
  const binary = await verifiedDriver();
  const uuid = randomUUID();
  const options = new firefox.Options()
    .addArguments("-headless")
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ [ADDON_ID]: uuid }),
    );
  if (process.env.MADAGAMASK_FIREFOX_PATH)
    options.setBinary(process.env.MADAGAMASK_FIREFOX_PATH);
  const driver = (await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      // Without this, Firefox refuses automated navigation to extension pages.
      new firefox.ServiceBuilder(binary).addArguments("--allow-system-access"),
    )
    .build()) as firefox.Driver;
  await driver.installAddon(resolve("dist/firefox"), true);
  return new Wallet(driver, uuid);
}
