import { createHandler } from "./handler.ts";
import { HEARTBEAT_KEY, startHeartbeat } from "./heartbeat.ts";

declare const BROWSER_TARGET: "chrome" | "firefox";

const handle = createHandler(
  chrome.runtime.id,
  chrome.runtime.getURL("popup.html"),
);

// Register synchronously so messages can wake a newly started worker.
chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    sendResponse(handle(message, sender));
    return false;
  },
);

if (BROWSER_TARGET === "chrome") {
  // Session storage remains at its default TRUSTED_CONTEXTS access level.
  startHeartbeat((timestamp) =>
    chrome.storage.session.set({ [HEARTBEAT_KEY]: timestamp }),
  );
}
