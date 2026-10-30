import { isAppStatus, type Request } from "../shared/messages.ts";

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element: ${id}`);
  return value as T;
}

const status = element("status");
const retry = element<HTMLButtonElement>("retry");
const openTab = element<HTMLButtonElement>("open-tab");

function connect() {
  retry.hidden = true;
  status.textContent = "Connecting to your wallet…";
  status.dataset.state = "loading";
  let settled = false;
  const fail = () => {
    if (settled) return;
    settled = true;
    status.textContent =
      "We couldn’t connect to your wallet. Please try again.";
    status.dataset.state = "error";
    retry.hidden = false;
  };
  const timeout = setTimeout(fail, 5_000);
  const request: Request = { version: 1, type: "app:get-status" };
  chrome.runtime.sendMessage(request, (response: unknown) => {
    const error = chrome.runtime.lastError;
    clearTimeout(timeout);
    if (settled) return;
    if (error || !isAppStatus(response)) {
      fail();
      return;
    }
    settled = true;
    status.textContent = "Your preview is ready to explore.";
    status.dataset.state = "ready";
  });
}

retry.addEventListener("click", connect);
openTab.addEventListener("click", () => {
  openTab.disabled = true;
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") }, () => {
    const error = chrome.runtime.lastError;
    openTab.disabled = false;
    if (error) {
      status.textContent = "The tab couldn’t be opened. Please try again.";
      status.dataset.state = "error";
    }
  });
});

connect();
