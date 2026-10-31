import { ProviderError, type Site } from "../core/dapps.ts";
import { userErrorMessage } from "../core/validation.ts";
import { SESSION_KEY } from "../core/vault.ts";
import { Wallet } from "../core/wallet.ts";
import { parseRequest } from "../shared/messages.ts";
import { authorize } from "./authorize.ts";
import { createHandler } from "./handler.ts";
import { HEARTBEAT_KEY, startHeartbeat } from "./heartbeat.ts";
import { extensionStorage } from "./storage.ts";

declare const BROWSER_TARGET: "chrome" | "firefox";
const popupUrl = chrome.runtime.getURL("popup.html");
const handle = createHandler(chrome.runtime.id, popupUrl);
const wallet = new Wallet(
  extensionStorage(chrome.storage.local, BROWSER_TARGET === "chrome"),
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
  // Firefox session storage is isolated by default, but its local storage is
  // not. Keep Firefox test-only until local data has an isolated backend.
  extensionStorage(chrome.storage.session),
);
let ready = wallet.ready;
function endSession() {
  wallet.vault.lock();
  wallet.dapps.invalidate("Wallet locked.");
  wallet.transactions.invalidate();
  ready = ready.then(() => wallet.vault.flushSession());
  void ready.catch(() => {});
}
chrome.runtime.onInstalled.addListener(endSession);
chrome.runtime.onStartup.addListener(endSession);
const expiryAlarm = "unlock-session-expiry";
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes[SESSION_KEY]) return;
  const saved = changes[SESSION_KEY].newValue as
    | { expiresAt?: number }
    | undefined;
  if (typeof saved?.expiresAt === "number") {
    void chrome.alarms
      .create(expiryAlarm, { when: saved.expiresAt })
      .catch(() => {});
  } else {
    void chrome.alarms.clear(expiryAlarm).catch(() => {});
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== expiryAlarm) return;
  void ready
    .then(async () => {
      // Delayed alarms must not lock a newer, active session.
      wallet.vault.expire();
      await wallet.vault.flushSession();
      await notifySites();
    })
    .catch(() => {});
});
void ready
  .then(async () => {
    const saved = (await chrome.storage.session.get(SESSION_KEY))[
      SESSION_KEY
    ] as { expiresAt?: number } | undefined;
    if (typeof saved?.expiresAt === "number")
      await chrome.alarms.create(expiryAlarm, { when: saved.expiresAt });
  })
  .catch(() => {});
const sites = new Map<number, Site>();
const lastEvents = new Map<number, string>();
let approvalWindowId: number | undefined;
wallet.dapps.isSiteActive = (site) =>
  sites.get(site.tabId)?.documentId === site.documentId &&
  sites.get(site.tabId)?.origin === site.origin;
wallet.dapps.onRequest = async (site) => {
  if (approvalWindowId !== undefined) {
    try {
      await chrome.windows.update(approvalWindowId, { focused: true });
      return;
    } catch {
      approvalWindowId = undefined;
    }
  }
  const tab = await chrome.tabs.get(site.tabId);
  const parent = await chrome.windows.get(tab.windowId);
  const width = 420;
  const position =
    parent.left !== undefined &&
    parent.top !== undefined &&
    parent.width !== undefined
      ? {
          left: parent.left + Math.max(0, parent.width - width),
          top: parent.top,
        }
      : {};
  const window = await chrome.windows.create({
    url: popupUrl,
    type: "popup",
    width,
    height: 720,
    ...position,
  });
  approvalWindowId = window?.id;
};
function closeFinishedApprovalWindow() {
  if (approvalWindowId === undefined || wallet.dapps.approvals().length) return;
  const id = approvalWindowId;
  // A following site request must open a new window, not reuse this closing one.
  // Its removal must not invalidate that following request either.
  approvalWindowId = undefined;
  void chrome.windows.remove(id).catch(() => {});
}
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
        void ready
          .then(() => wallet.dapps.request(request.request, site))
          .then(
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
                    error instanceof ProviderError
                      ? error.message
                      : userErrorMessage(
                          error,
                          "Invalid or failed wallet request.",
                        ),
                },
              }),
          );
        return true;
      }
    }
    if (request.type === "app:command") {
      const operation = wallet.run(request.action, request.params);
      void operation.then(
        (value) => {
          sendResponse({ ok: true, value });
          if (
            request.action === "approveDapp" ||
            request.action === "rejectDapp"
          )
            closeFinishedApprovalWindow();
          void notifySites().catch(() => {});
        },
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: userErrorMessage(
              error,
              "Operation failed. Please try again.",
            ),
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
          ["submitting", "pending", "unknown", "unseen"].includes(item.status),
        )
      )
        await wallet.run("refreshActivity", {});
    })
    .catch(() => {})
    .finally(() => {
      tracking = false;
    });
}, 30_000);
