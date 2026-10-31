import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Exercise actual event-page unloading, without attaching a background debugger.
const profile = await mkdtemp(join(tmpdir(), "madagamask-firefox-lifecycle-"));
const uuid = crypto.randomUUID();
const evidence = {
  date: new Date().toISOString(),
  backgroundDebuggerAttached: false,
};
await writeFile(
  join(profile, "user.js"),
  `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ "madagamask@madagamask.local": uuid }))});\n`,
);
const firefox = spawn(
  process.env.MADAGAMASK_FIREFOX_PATH ??
    "/Applications/Firefox.app/Contents/MacOS/firefox",
  [
    "--headless",
    "--no-remote",
    "--profile",
    profile,
    "--remote-debugging-port",
    "0",
    "about:blank",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
  },
);
let socket;
const pending = new Map();
let id = 0;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`Firefox startup timeout ${output.slice(-500)}`)),
      15000,
    );
    for (const pipe of [firefox.stdout, firefox.stderr])
      pipe.on("data", (chunk) => {
        output += chunk;
        const match = output.match(
          /WebDriver BiDi listening on (ws:\/\/[^\s]+)/,
        );
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    firefox.once("error", reject);
  });
  socket = new WebSocket(`${endpoint}/session`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.type === "error")
      request.reject(new Error(JSON.stringify(message)));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const number = ++id;
      const timer = setTimeout(() => {
        pending.delete(number);
        reject(new Error(`Timeout ${method}`));
      }, 15000);
      pending.set(number, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: number, method, params }));
    });
  const session = await send("session.new", {
    capabilities: { alwaysMatch: { acceptInsecureCerts: false } },
  });
  evidence.browser = session.capabilities.browserVersion;
  await send("webExtension.install", {
    extensionData: { type: "path", path: resolve("dist/firefox") },
  });
  const evaluate = async (context, expression) => {
    const result = await send("script.evaluate", {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: "none",
    });
    if (result.type !== "success") throw new Error(JSON.stringify(result));
    return result.result.value;
  };
  const command = async (context, action, params = {}) => {
    const result = JSON.parse(
      await evaluate(
        context,
        `chrome.runtime.sendMessage(${JSON.stringify({ version: 1, type: "app:command", action, params })}).then(JSON.stringify)`,
      ),
    );
    assert.equal(result.ok, true, result.error);
    return result.value;
  };
  const instance = (context) =>
    evaluate(
      context,
      'chrome.runtime.sendMessage({version:1,type:"app:get-status"}).then(x=>x.instanceId)',
    );
  const open = async () => {
    const { context } = await send("browsingContext.create", { type: "tab" });
    await send("browsingContext.navigate", {
      context,
      url: `moz-extension://${uuid}/popup.html`,
      wait: "complete",
    });
    return context;
  };
  let popup = await open();
  const password = "disposable-firefox-lifecycle-password";
  await command(popup, "import", {
    password,
    phrase: "test test test test test test test test test test test junk",
  });
  const first = await instance(popup);
  assert.equal((await command(popup, "state")).vault.autoLockMinutes, 30);
  await send("browsingContext.close", { context: popup });
  console.log("Firefox: all wallet pages closed for 40 seconds.");
  await delay(40000);
  popup = await open();
  assert.notEqual(
    await instance(popup),
    first,
    "Background must actually restart",
  );
  assert.equal((await command(popup, "state")).vault.state, "unlocked");
  evidence.idle40Seconds = "fresh background; restored unlocked session";
  console.log("Firefox restored the session after background unloading.");
  await command(popup, "lock");
  assert.equal(
    await evaluate(
      popup,
      'chrome.storage.session.get("unlockSession").then(x=>!!x.unlockSession)',
    ),
    false,
  );
  await command(popup, "unlock", { password });
  await command(popup, "autoLock", { minutes: 1 });
  await send("browsingContext.close", { context: popup });
  console.log(
    "Firefox: checking expiry with all wallet pages closed for 65 seconds.",
  );
  await delay(35000);
  console.log("Firefox expiry check still running.");
  await delay(30000);
  popup = await open();
  assert.equal((await command(popup, "state")).vault.state, "locked");
  assert.equal(
    await evaluate(
      popup,
      'chrome.storage.session.get("unlockSession").then(x=>!!x.unlockSession)',
    ),
    false,
  );
  await delay(100);
  assert.equal(
    await evaluate(popup, 'document.activeElement?.getAttribute("name")'),
    "password",
  );
  assert.equal(
    await evaluate(
      popup,
      'document.body.textContent.includes("At least 12 characters")',
    ),
    false,
  );
  evidence.expiry =
    "locked after 65 seconds; session material removed; unlock input focused";
  await command(popup, "unlock", { password });
  await evaluate(popup, "setTimeout(()=>chrome.runtime.reload(),100); true");
  await delay(1500);
  popup = await open();
  assert.equal((await command(popup, "state")).vault.state, "locked");
  assert.equal(
    await evaluate(
      popup,
      'chrome.storage.session.get("unlockSession").then(x=>!!x.unlockSession)',
    ),
    false,
  );
  evidence.extensionReload = "vault preserved; session locked and removed";
  await command(popup, "unlock", { password });
  assert.equal(
    (await command(popup, "state")).vault.accounts[0].address,
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  );
  console.log("Firefox lifecycle validation passed.");
  await send("session.end");
} finally {
  await writeFile(
    "artifacts/firefox-lifecycle.json",
    JSON.stringify(evidence, null, 2),
  );
  socket?.close();
  firefox.kill("SIGTERM");
  await delay(1000);
  await rm(profile, { recursive: true, force: true });
}
