import type { Request } from "../shared/messages.ts";

// Foundation handshake only. There is deliberately no page-to-extension bridge yet.
const request: Request = { version: 1, type: "content:hello" };
chrome.runtime.sendMessage(request, () => {
  // The extension can be reloaded while this page is open.
  void chrome.runtime.lastError;
});
