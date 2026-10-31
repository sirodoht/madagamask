import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

// A raw browser-level pipe deliberately never attaches a debugger to the worker.
// Playwright's automatic worker attachment would invalidate an idle-lifetime test.
class CDP extends EventEmitter {
  process: ChildProcess;
  private input: Writable;
  private next = 0;
  private requests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(executable: string, profile: string) {
    super();
    this.process = spawn(
      executable,
      [
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--enable-unsafe-extension-debugging",
        "--remote-debugging-pipe",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    this.input = this.process.stdio[3] as Writable;
    let buffer = "";
    (this.process.stdio[4] as Readable).on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      while (buffer.includes("\0")) {
        const end = buffer.indexOf("\0");
        const text = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!text) continue;
        const message = JSON.parse(text);
        const request = this.requests.get(message.id);
        if (request) {
          clearTimeout(request.timer);
          this.requests.delete(message.id);
          if (message.error)
            request.reject(new Error(JSON.stringify(message.error)));
          else request.resolve(message.result);
        } else this.emit(message.method, message.params, message.sessionId);
      }
    });
    this.process.on("exit", () => {
      for (const request of this.requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Browser exited"));
      }
      this.requests.clear();
    });
  }
  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
      this.requests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.input.write(
        `${JSON.stringify({ id, method, params, sessionId })}\0`,
      );
    });
  }
  async close() {
    try {
      await this.send("Browser.close");
    } catch {}
    if (this.process.exitCode === null)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.process.kill("SIGKILL");
          resolve();
        }, 5000);
        this.process.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
  }
}
const executable =
  process.env.MADAGAMASK_CHROME_PATH ?? chromium.executablePath();
const profile = await mkdtemp(join(tmpdir(), "madagamask-lifecycle-"));
const extensionPath = await mkdtemp(
  join(tmpdir(), "madagamask-lifecycle-extension-"),
);
await cp(resolve("dist/chrome"), extensionPath, { recursive: true });
let cdp = new CDP(executable, profile);
let extensionId = "";
const evidence: Record<string, unknown> = {
  date: new Date().toISOString(),
  executable,
  workerDebuggerAttached: false,
};
async function install() {
  const version = await cdp.send("Browser.getVersion");
  evidence.browser = version.product;
  const loaded = await cdp.send<{ id: string }>("Extensions.loadUnpacked", {
    path: extensionPath,
  });
  extensionId = loaded.id;
}
async function open() {
  const target = await cdp.send<{ targetId: string }>("Target.createTarget", {
    url: `chrome-extension://${extensionId}/popup.html`,
  });
  const attached = await cdp.send<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId: target.targetId, flatten: true },
  );
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(100);
    try {
      if (
        await evaluate<boolean>(
          attached.sessionId,
          "typeof chrome.runtime?.sendMessage === 'function'",
        )
      )
        break;
    } catch {}
  }

  return { targetId: target.targetId, sessionId: attached.sessionId };
}
async function evaluate<T>(sessionId: string, expression: string): Promise<T> {
  const result = await cdp.send<{
    result: { value: T };
    exceptionDetails?: unknown;
  }>(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function command(
  sessionId: string,
  action: string,
  params: Record<string, unknown> = {},
) {
  const result = await evaluate<{
    ok: boolean;
    value: { vault: { state: string; accounts: { address: string }[] } };
    error: string;
  }>(
    sessionId,
    `chrome.runtime.sendMessage(${JSON.stringify({ version: 1, type: "app:command", action, params })})`,
  );
  assert.equal(result.ok, true, result.error);
  return result.value;
}
async function instance(sessionId: string) {
  return evaluate<{ instanceId: string }>(
    sessionId,
    'chrome.runtime.sendMessage({version:1,type:"app:get-status"})',
  );
}
try {
  await install();
  let page = await open();
  await command(page.sessionId, "import", {
    password: "disposable-lifecycle-password",
    phrase: "test test test test test test test test test test test junk",
  });
  const first = await instance(page.sessionId);
  const initial = await command(page.sessionId, "state");
  assert.equal(initial.vault.state, "unlocked");
  await cdp.send("Target.closeTarget", { targetId: page.targetId });
  const cpuBefore = await cdp.send("SystemInfo.getProcessInfo");
  console.log(
    "Idle continuity: all extension pages closed for 45 seconds; no worker debugger attached.",
  );
  await delay(45_000);
  const cpuAfter = await cdp.send("SystemInfo.getProcessInfo");
  page = await open();
  assert.equal(
    (await command(page.sessionId, "state")).vault.state,
    "unlocked",
  );
  assert.equal((await instance(page.sessionId)).instanceId, first.instanceId);
  evidence.idle45Seconds = "same worker; unlocked session preserved";
  evidence.idleCpu = {
    before: cpuBefore.processInfo,
    after: cpuAfter.processInfo,
  };
  console.log("Idle continuity passed. Forcing worker termination.");
  await cdp.send("ServiceWorker.enable", {}, page.sessionId);
  await cdp.send("ServiceWorker.stopAllWorkers", {}, page.sessionId);
  await delay(500);
  assert.equal((await command(page.sessionId, "state")).vault.state, "unlocked");
  assert.notEqual(
    (await instance(page.sessionId)).instanceId,
    first.instanceId,
  );
  evidence.forcedTermination = "session restored; fresh worker identity";
  await command(page.sessionId, "autoLock", { minutes: 1 });
  const beforeAuto = await instance(page.sessionId);
  await cdp.send("Target.closeTarget", { targetId: page.targetId });
  console.log("Auto-lock: waiting 65 seconds while heartbeat runs.");
  await delay(35_000);
  console.log("Auto-lock timer check still running.");
  await delay(30_000);
  page = await open();
  assert.equal((await command(page.sessionId, "state")).vault.state, "locked");
  assert.equal(
    (await instance(page.sessionId)).instanceId,
    beforeAuto.instanceId,
  );
  evidence.autoLock = "locked after 65 seconds; heartbeat kept same worker";
  await command(page.sessionId, "unlock", {
    password: "disposable-lifecycle-password",
  });
  const manifest = JSON.parse(
    await readFile(join(extensionPath, "manifest.json"), "utf8"),
  );
  manifest.version = "0.1.1";
  await writeFile(
    join(extensionPath, "manifest.json"),
    JSON.stringify(manifest),
  );
  const manager = await cdp.send<{ targetId: string }>("Target.createTarget", {
    url: "chrome://extensions/",
  });
  const managerSession = await cdp.send<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId: manager.targetId, flatten: true },
  );
  await delay(1000);
  await evaluate(
    managerSession.sessionId,
    "chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})",
  );
  await evaluate(
    managerSession.sessionId,
    `chrome.developerPrivate.reload(${JSON.stringify(extensionId)},{failQuietly:false})`,
  );
  await delay(1000);
  page = await open();
  assert.equal((await command(page.sessionId, "state")).vault.state, "locked");
  evidence.extensionReload =
    "developer reload and manifest upgrade to 0.1.1 in isolated copy: vault preserved; session locked";
  await command(page.sessionId, "unlock", {
    password: "disposable-lifecycle-password",
  });
  await cdp.close();
  cdp = new CDP(executable, profile);
  await install();
  page = await open();
  assert.equal((await command(page.sessionId, "state")).vault.state, "locked");
  const restored = await command(page.sessionId, "unlock", {
    password: "disposable-lifecycle-password",
  });
  assert.equal(
    restored.vault.accounts[0]?.address,
    initial.vault.accounts[0]?.address,
  );
  evidence.browserRestart = "locked; same address restored after unlock";
  console.log("Lifecycle validation passed.");
} finally {
  await writeFile(
    "artifacts/lifecycle.json",
    JSON.stringify(evidence, null, 2),
  );
  await cdp.close();
  await rm(profile, { recursive: true, force: true });
  await rm(extensionPath, { recursive: true, force: true });
}
