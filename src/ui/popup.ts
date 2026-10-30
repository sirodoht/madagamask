import encodeQR from "qr";
import type { Activity, Preview } from "../core/transactions.ts";
import type { Wallet } from "../core/wallet.ts";
import { button, el, type Field, form } from "./dom.ts";

type View = Awaited<ReturnType<Wallet["view"]>>;
const app = document.getElementById("app") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
let state: View;
let secretTimer: ReturnType<typeof setTimeout> | undefined;
let showingSecret = false;
let busy = false;
let screenId = 0;

async function rpc<T = View>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { version: 1, type: "app:command", action, params },
      (response: { ok: boolean; value?: T; error?: string } | undefined) => {
        if (chrome.runtime.lastError || !response?.ok)
          reject(
            new Error(
              response?.error ??
                "Could not reach the wallet. Reopen the extension and try again.",
            ),
          );
        else resolve(response.value as T);
      },
    );
  });
}
async function attempt(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  status.textContent = "Working…";
  status.dataset.state = "loading";
  try {
    await action();
    status.textContent = "";
    status.dataset.state = "ready";
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "Something went wrong.";
    status.dataset.state = "error";
  } finally {
    busy = false;
  }
}
function screen(title: string) {
  screenId += 1;
  clearTimeout(secretTimer);
  showingSecret = false;
  app.replaceChildren(el("h1", title));
  app.setAttribute("aria-busy", "false");
}
function back() {
  app.append(button("Back", () => home(), true));
}
function fields(
  title: string,
  inputs: Field[],
  label: string,
  action: (values: Record<string, string>) => Promise<void>,
) {
  screen(title);
  app.append(form(inputs, label, (values) => attempt(() => action(values))));
  back();
}
async function command(action: string, params: Record<string, unknown> = {}) {
  state = await rpc(action, params);
  home();
}
const passwordField: Field = {
  key: "password",
  label: "Password",
  type: "password",
  help: "At least 12 characters.",
};

function onboarding(importing: boolean) {
  fields(
    importing ? "Import wallet" : "Create wallet",
    [
      ...(importing
        ? [
            {
              key: "phrase",
              label: "Recovery phrase",
              type: "textarea",
              help: "English BIP39. Standard Ethereum path m/44'/60'/0'/0/index. BIP39 passphrases are not supported.",
            },
          ]
        : []),
      passwordField,
      { key: "confirm", label: "Confirm password", type: "password" },
    ],
    importing ? "Import test wallet" : "Create test wallet",
    async (values) => {
      if (values.password !== values.confirm)
        throw new Error("Passwords do not match.");
      await command(importing ? "import" : "create", {
        password: values.password,
        ...(importing ? { phrase: values.phrase } : {}),
      });
    },
  );
}
function backup(index?: number) {
  fields(
    index === undefined ? "Back up recovery phrase" : "Export imported key",
    [passwordField],
    "Reveal backup",
    async (values) => {
      const { secret } = await rpc<{ secret: string }>("reveal", {
        password: values.password,
        ...(index !== undefined ? { index } : {}),
      });
      screen("Keep this private");
      showingSecret = true;
      app.append(
        el(
          "p",
          "Write this down offline. Anyone with this backup can control the account. It will hide after one minute.",
        ),
      );
      app.append(el("pre", secret, "secret"));
      if (index === undefined && !state.vault.backedUp) {
        app.append(
          form(
            [
              {
                key: "phrase",
                label: "Confirm your recovery phrase",
                type: "textarea",
              },
            ],
            "Confirm backup",
            (values) => attempt(() => command("confirmBackup", values)),
          ),
        );
      }
      back();
      secretTimer = setTimeout(() => home(), 60_000);
    },
  );
}
function settings() {
  screen("Settings");
  app.append(
    button(
      "Add or edit network",
      () =>
        fields(
          "Custom network",
          [
            { key: "id", label: "Chain ID", type: "number" },
            { key: "name", label: "Network name" },
            { key: "symbol", label: "Currency symbol", value: "ETH" },
            {
              key: "rpc",
              label: "RPC URL",
              help: "This provider receives your address and requests. HTTPS required, except localhost. Existing chain IDs replace their endpoint.",
            },
          ],
          "Verify and save network",
          (values) =>
            command("addNetwork", { ...values, id: Number(values.id) }),
        ),
      true,
    ),
  );
  app.append(button("Back up recovery phrase", () => backup()));
  if (state.vault.accounts[state.vault.selected]?.imported)
    app.append(
      button("Export imported key", () => backup(state.vault.selected), true),
    );
  app.append(
    button(
      "Add account",
      () =>
        fields(
          "Add account",
          [{ key: "name", label: "Account name" }],
          "Add account",
          (values) => command("addAccount", values),
        ),
      true,
    ),
  );
  app.append(
    button(
      "Import private key",
      () =>
        fields(
          "Import private key",
          [
            { key: "name", label: "Account name" },
            {
              key: "privateKey",
              label: "Private key",
              type: "password",
              help: "Imported keys are not recovered by your recovery phrase. Keep a separate backup. Use test keys only.",
            },
          ],
          "Import key",
          (values) => command("addAccount", values),
        ),
      true,
    ),
  );
  app.append(
    button(
      "Rename account",
      () =>
        fields(
          "Rename account",
          [{ key: "name", label: "Account name" }],
          "Save name",
          (values) => command("renameAccount", values),
        ),
      true,
    ),
  );
  app.append(
    button(
      "Change password",
      () =>
        fields(
          "Change password",
          [
            passwordField,
            { key: "newPassword", label: "New password", type: "password" },
          ],
          "Change password",
          (values) => command("changePassword", values),
        ),
      true,
    ),
  );
  app.append(
    button(
      "Auto-lock",
      () =>
        fields(
          "Auto-lock",
          [
            {
              key: "minutes",
              label: "Minutes of inactivity (1–30)",
              type: "number",
              value: String(state.vault.autoLockMinutes),
            },
          ],
          "Save auto-lock",
          (values) => command("autoLock", { minutes: Number(values.minutes) }),
        ),
      true,
    ),
  );
  app.append(
    button(
      "Reset wallet",
      () =>
        fields(
          "Reset wallet",
          [
            passwordField,
            {
              key: "confirmation",
              label: "Type DELETE",
              help: "This removes your local wallet. Back up the recovery phrase AND all imported private keys first.",
            },
          ],
          "Delete local wallet",
          (values) => command("reset", values),
        ),
      true,
    ),
  );
  back();
}
function review(preview: Preview) {
  screen("Review transaction");
  const lines = [
    ["Network", `${preview.network} (chain ${preview.chainId})`],
    ["From", preview.from],
    ["To", preview.to],
    ["Amount", `${preview.amount} ${preview.symbol}`],
    ["Maximum fee", `${preview.fee} ${preview.symbol}`],
    ["Maximum total", `${preview.total} ${preview.symbol}`],
  ];
  for (const [label, value] of lines) app.append(el("p", `${label}: ${value}`));
  if (preview.replacement)
    app.append(
      el(
        "p",
        "This replaces a pending transaction. Speed-up or cancellation is not guaranteed.",
      ),
    );
  if (preview.data !== "0x") {
    app.append(el("p", "Contract interaction: effects may be unknown."));
    const details = el("details");
    details.append(
      el("summary", "Transaction data"),
      el("pre", preview.data, "secret"),
    );
    app.append(details);
  }
  app.append(
    button("Confirm and send", () =>
      attempt(async () => {
        const tx = await rpc<Activity>("approveSend", { id: preview.id });
        screen(
          tx.status === "pending"
            ? "Transaction submitted"
            : "Check transaction status",
        );
        app.append(
          el("p", tx.hash, "address"),
          el(
            "p",
            tx.error ??
              "Submitted does not mean confirmed. Check Activity for progress.",
          ),
        );
        back();
      }),
    ),
    button(
      "Reject",
      () =>
        attempt(async () => {
          await rpc("cancelSend", { id: preview.id });
          home();
        }),
      true,
    ),
  );
}
function send() {
  fields(
    "Send test assets",
    [
      { key: "to", label: "Recipient address" },
      {
        key: "amount",
        label: "Amount",
        help: "Use a decimal amount. Network fees are shown before confirmation.",
      },
    ],
    "Review transaction",
    async (values) => {
      review(await rpc<Preview>("prepareSend", values));
    },
  );
}
async function activity(refresh = false) {
  const items = await rpc<Activity[]>(refresh ? "refreshActivity" : "activity");
  screen("Activity");
  app.append(
    el(
      "p",
      "Transactions initiated by this wallet only. Incoming transfers and imported accounts’ past activity are not indexed.",
    ),
  );
  const account = state.vault.accounts[state.vault.selected];
  const relevant = items.filter(
    (item) =>
      item.chainId === state.networks.selected &&
      item.from === account?.address,
  );
  if (!relevant.length) app.append(el("p", "No transactions yet."));
  for (const item of relevant) {
    const card = el("section", undefined, "card stack");
    card.append(
      el("h2", item.status),
      el("p", item.hash, "address"),
      el("p", `To: ${item.to}`),
    );
    if (item.error) card.append(el("p", item.error));
    if (["pending", "unknown", "unseen"].includes(item.status))
      for (const cancel of [false, true])
        card.append(
          button(
            cancel ? "Cancel transaction" : "Speed up",
            () =>
              attempt(async () => {
                review(
                  await rpc<Preview>("replaceTransaction", {
                    hash: item.hash,
                    cancel,
                  }),
                );
              }),
            true,
          ),
        );
    app.append(card);
  }
  app.append(
    button("Refresh activity", () => attempt(() => activity(true)), true),
  );
  back();
}
function receive() {
  const account = state.vault.accounts[state.vault.selected];
  const network = state.networks.items.find(
    (item) => item.id === state.networks.selected,
  );
  if (!account || !network) return;
  screen("Receive test assets");
  app.append(
    el("p", `${network.name} · chain ${network.id}`),
    el("p", account.address, "address"),
  );
  const grid = encodeQR(`ethereum:${account.address}@${network.id}`, "raw", {
    border: 4,
    scale: 1,
  });
  const canvas = el("canvas");
  canvas.width = grid.length * 6;
  canvas.height = grid.length * 6;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    `Receive QR code for ${account.address} on ${network.name}`,
  );
  canvas.style.maxWidth = "100%";
  const context = canvas.getContext("2d");
  if (context) {
    grid.forEach((row, y) => {
      row.forEach((cell, x) => {
        context.fillStyle = cell ? "#000" : "#fff";
        context.fillRect(x * 6, y * 6, 6, 6);
      });
    });
  }
  app.append(
    canvas,
    el("p", "Only send test assets on the network shown above."),
  );
  back();
}
function home() {
  const vault = state.vault;
  if (vault.state === "not-created") {
    screen("A little simpler. All yours.");
    app.append(
      el(
        "p",
        "Create a fresh test wallet, or restore one from its recovery phrase.",
      ),
      button("Create wallet", () => onboarding(false)),
      button("Import wallet", () => onboarding(true), true),
    );
  } else if (vault.state === "locked") {
    screen("Welcome back");
    app.append(
      form([passwordField], "Unlock", (values) =>
        attempt(() => command("unlock", values)),
      ),
    );
  } else {
    screen("Your wallet");
    const networkLabel = el("label", "Network", "stack field");
    const networkSelect = el("select");
    state.networks.items.forEach((network) => {
      const option = el("option", network.name);
      option.value = String(network.id);
      option.selected = network.id === state.networks.selected;
      networkSelect.append(option);
    });
    networkSelect.addEventListener("change", () => {
      void attempt(() =>
        command("selectNetwork", { id: Number(networkSelect.value) }),
      );
    });
    networkLabel.append(networkSelect);
    app.append(networkLabel);
    const label = el("label", "Account", "stack field");
    const select = el("select");
    vault.accounts.forEach((account, index) => {
      const option = el("option", account.name);
      option.value = String(index);
      option.selected = index === vault.selected;
      select.append(option);
    });
    select.addEventListener("change", () => {
      void attempt(() =>
        command("selectAccount", { index: Number(select.value) }),
      );
    });
    label.append(select);
    app.append(label);
    const account = vault.accounts[vault.selected];
    if (account) {
      const balance = el("p", "Balance not loaded", "balance");
      app.append(balance);
      const currentScreen = screenId;
      const refresh = async () => {
        balance.textContent = "Loading balance…";
        try {
          const value = await rpc<{
            amount: string;
            symbol: string;
            address: string;
            chainId: number;
          }>("balance");
          if (
            currentScreen === screenId &&
            value.address === account.address &&
            value.chainId === state.networks.selected
          )
            balance.textContent = `${value.amount} ${value.symbol}`;
        } catch {
          if (currentScreen === screenId)
            balance.textContent = "Balance unavailable. Refresh to try again.";
        }
      };
      app.append(
        button("Refresh balance", refresh, true),
        button("Receive", () => receive(), true),
        button("Send", () => send()),
        button("Activity", () => attempt(() => activity()), true),
      );

      app.append(
        el("p", account.address, "address"),
        button(
          "Copy address",
          () =>
            attempt(async () => {
              await navigator.clipboard.writeText(account.address);
              status.textContent = "Address copied.";
            }),
          true,
        ),
      );
    }
    if (!vault.backedUp)
      app.append(
        el("p", "Back up your recovery phrase before sending or signing."),
        button("Back up now", () => backup()),
      );
    app.append(
      button("Settings", () => settings(), true),
      button("Lock wallet", () => attempt(() => command("lock")), true),
    );
  }
}
document.getElementById("open-tab")?.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && showingSecret) home();
});
// Only replace a screen when lock state changes; preserve forms and focus otherwise.
setInterval(() => {
  if (busy || !state || document.hidden) return;
  void rpc<View>("state")
    .then((next) => {
      if (next.vault.state !== state.vault.state) {
        state = next;
        home();
      }
    })
    .catch(() => {});
}, 3_000);
void attempt(async () => {
  state = await rpc("state");
  home();
});
