import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { download } from "geckodriver";
import {
  Builder,
  By,
  until,
  type WebDriver,
  type WebElement,
} from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const GECKODRIVER_VERSION = "0.37.1";
const ADDON_ID = "madagamask@madagamask.local";
const TIMEOUT = 15_000;

export const PASSWORD = "a-disposable-test-password";

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
  async click(name: string) {
    await (await this.button(name)).click();
  }
  field(label: string) {
    return this.visible(By.css(`[aria-label="${label}"]`));
  }
  async fill(label: string, value: string) {
    const field = await this.field(label);
    await field.clear();
    await field.sendKeys(value);
  }
  async text(selector: string) {
    return (await this.visible(By.css(selector))).getText();
  }
  async createWallet() {
    await this.openPopup();
    await this.click("Create wallet");
    await this.fill("Password", PASSWORD);
    await this.fill("Confirm password", PASSWORD);
    await this.click("Create wallet");
    return this.field("Account");
  }
  async quit() {
    await this.driver.quit();
  }
}

export async function launch() {
  const binary = await download(GECKODRIVER_VERSION);
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
