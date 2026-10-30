import { UserError } from "../core/validation.ts";
import { Wallet } from "../core/wallet.ts";
import { parseRequest } from "../shared/messages.ts";
import { authorize } from "./authorize.ts";
import { createHandler } from "./handler.ts";
import { HEARTBEAT_KEY, startHeartbeat } from "./heartbeat.ts";

declare const BROWSER_TARGET: "chrome" | "firefox";
const popupUrl = chrome.runtime.getURL("popup.html");
const handle = createHandler(chrome.runtime.id, popupUrl);
const wallet = new Wallet({
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: async (key, value) => {
    await chrome.storage.local.set({ [key]: value });
  },
  remove: async (key) => {
    await chrome.storage.local.remove(key);
  },
});
chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    const request = parseRequest(message);
    if (!request || !authorize(request, sender, chrome.runtime.id, popupUrl)) {
      sendResponse({
        ok: false,
        error: request ? "UNAUTHORIZED" : "INVALID_REQUEST",
      });
      return false;
    }
    if (request.type === "app:command") {
      void wallet.run(request.action, request.params).then(
        (value) => sendResponse({ ok: true, value }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error:
              error instanceof UserError
                ? error.message
                : "Operation failed. Please try again.",
          }),
      );
      return true;
    }
    sendResponse(handle(message, sender));
    return false;
  },
);
setInterval(() => wallet.vault.expire(), 1_000);
if (BROWSER_TARGET === "chrome") {
  startHeartbeat((timestamp) =>
    chrome.storage.session.set({ [HEARTBEAT_KEY]: timestamp }),
  );
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
