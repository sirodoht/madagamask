import { ProviderError, type Site } from "../core/dapps.ts";
import { UserError } from "../core/validation.ts";
import { Wallet } from "../core/wallet.ts";
import { parseRequest } from "../shared/messages.ts";
import { authorize } from "./authorize.ts";
import { createHandler } from "./handler.ts";
import { HEARTBEAT_KEY, startHeartbeat } from "./heartbeat.ts";

declare const BROWSER_TARGET: "chrome" | "firefox";
const popupUrl = chrome.runtime.getURL("popup.html");
const handle = createHandler(chrome.runtime.id, popupUrl);
const wallet = new Wallet(
  {
    get: async (key) => (await chrome.storage.local.get(key))[key],
    set: async (key, value) => {
      await chrome.storage.local.set({ [key]: value });
    },
    remove: async (key) => {
      await chrome.storage.local.remove(key);
    },
  },
  async () => {
    const meta = (await (
      await fetch(chrome.runtime.getURL("phishing-meta.json"))
    ).json()) as { fetchedAt: number };
    const response = await fetch(chrome.runtime.getURL("phishing.json.gz"));
    if (!response.body) throw new Error("Missing protection data");
    const domains = (await new Response(
      response.body.pipeThrough(new DecompressionStream("gzip")),
    ).json()) as string[];
    return { updatedAt: meta.fetchedAt, domains };
  },
);
const sites = new Map<number, Site>();
const lastEvents = new Map<number, string>();
let approvalWindowId: number | undefined;
wallet.dapps.isSiteActive = (site) =>
  sites.get(site.tabId)?.documentId === site.documentId &&
  sites.get(site.tabId)?.origin === site.origin;
wallet.dapps.onRequest = async () => {
  if (approvalWindowId !== undefined) {
    try {
      await chrome.windows.update(approvalWindowId, { focused: true });
      return;
    } catch {
      approvalWindowId = undefined;
    }
  }
  const window = await chrome.windows.create({
    url: popupUrl,
    type: "popup",
    width: 420,
    height: 720,
  });
  approvalWindowId = window?.id;
};
async function notifySites() {
  const network = await wallet.networks.selected();
  for (const [tabId, site] of sites) {
    const accounts = await wallet.dapps.accounts(site.origin);
    const chain = `0x${network.id.toString(16)}`;
    const fingerprint = JSON.stringify([accounts, chain]);
    if (lastEvents.get(tabId) === fingerprint) continue;
    lastEvents.set(tabId, fingerprint);
    for (const [event, value] of [
      ["accountsChanged", accounts],
      ["chainChanged", chain],
    ] as const)
      void chrome.tabs
        .sendMessage(
          tabId,
          { type: "provider:event", event, value },
          { documentId: site.documentId },
        )
        .catch(() => {});
  }
}
chrome.tabs.onRemoved.addListener((tabId) => {
  wallet.dapps.rejectTab(tabId);
  sites.delete(tabId);
  lastEvents.delete(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") {
    wallet.dapps.rejectTab(tabId);
    sites.delete(tabId);
    lastEvents.delete(tabId);
  }
});
chrome.windows.onRemoved.addListener((id) => {
  if (id === approvalWindowId) {
    approvalWindowId = undefined;
    wallet.dapps.invalidate("Approval window closed.");
  }
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
    if (request.type === "content:hello" || request.type === "site:request") {
      const site: Site = {
        origin: new URL(sender.url as string).origin,
        tabId: sender.tab?.id as number,
        documentId: sender.documentId ?? (sender.url as string),
      };
      sites.set(site.tabId, site);
      if (request.type === "site:request") {
        void wallet.dapps.request(request.request, site).then(
          (value) => {
            sendResponse({ ok: true, value });
            void notifySites().catch(() => {});
          },
          (error: unknown) =>
            sendResponse({
              ok: false,
              error: {
                code: error instanceof ProviderError ? error.code : -32603,
                message:
                  error instanceof ProviderError || error instanceof UserError
                    ? error.message
                    : "Invalid or failed wallet request.",
              },
            }),
        );
        return true;
      }
    }
    if (request.type === "app:command") {
      void wallet.run(request.action, request.params).then(
        (value) => {
          sendResponse({ ok: true, value });
          void notifySites().catch(() => {});
        },
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
let lastEpoch = wallet.vault.generation();
setInterval(() => {
  const epoch = wallet.vault.generation();
  if (epoch !== lastEpoch) {
    lastEpoch = epoch;
    void wallet.vault
      .view()
      .then((view) => {
        if (view.state !== "unlocked") {
          wallet.dapps.invalidate("Wallet locked.");
          wallet.transactions.invalidate();
        }
        return notifySites();
      })
      .catch(() => {});
  }
}, 1_000);
if (BROWSER_TARGET === "chrome") {
  startHeartbeat((timestamp) =>
    chrome.storage.session.set({ [HEARTBEAT_KEY]: timestamp }),
  );
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

let tracking = false;
setInterval(() => {
  if (tracking) return;
  tracking = true;
  void wallet.transactions
    .list()
    .then(async (items) => {
      if (
        items.some((item) =>
          ["submitting", "pending", "unknown"].includes(item.status),
        )
      )
        await wallet.run("refreshActivity", {});
    })
    .catch(() => {})
    .finally(() => {
      tracking = false;
    });
}, 30_000);
