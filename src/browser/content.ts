// Isolated world: never trust page claims of origin, account, or authorization.
if (window.top === window) {
  let count = 0;
  let since = Date.now();
  const pending = new Set<string>();
  chrome.runtime.sendMessage({ version: 1, type: "content:hello" }, () => {
    void chrome.runtime.lastError;
  });
  window.addEventListener("message", (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !event.data ||
      event.data.channel !== "madagamask:request"
    )
      return;
    const data = event.data;
    if (
      typeof data.id !== "string" ||
      data.id.length > 100 ||
      pending.has(data.id)
    )
      return;
    const respond = (
      result: unknown,
      error?: { code: number; message: string },
    ) =>
      window.postMessage(
        { channel: "madagamask:response", id: data.id, result, error },
        location.origin,
      );
    if (Date.now() - since > 60_000) {
      since = Date.now();
      count = 0;
    }
    if (++count > 100 || pending.size >= 16) {
      respond(null, { code: -32002, message: "Too many wallet requests." });
      return;
    }
    try {
      if (JSON.stringify(data.request).length > 32768) throw new Error();
    } catch {
      respond(null, { code: -32602, message: "Invalid request." });
      return;
    }
    pending.add(data.id);
    chrome.runtime.sendMessage(
      { version: 1, type: "site:request", request: data.request },
      (
        response:
          | {
              ok: boolean;
              value?: unknown;
              error?: { code: number; message: string };
            }
          | undefined,
      ) => {
        pending.delete(data.id);
        const failed = chrome.runtime.lastError;
        if (failed || !response)
          respond(null, {
            code: 4900,
            message:
              "Wallet disconnected. Reload this page after reloading the extension.",
          });
        else if (!response.ok)
          respond(
            null,
            response.error ?? {
              code: -32603,
              message: "Wallet request failed.",
            },
          );
        else respond(response.value);
      },
    );
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      !message ||
      typeof message !== "object"
    )
      return;
    const data = message as { type?: string; event?: string; value?: unknown };
    if (data.type === "provider:event")
      window.postMessage(
        {
          channel: "madagamask:response",
          event: data.event,
          value: data.value,
        },
        location.origin,
      );
  });
}
