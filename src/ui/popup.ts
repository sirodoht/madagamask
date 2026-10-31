import encodeQR from "qr";
import type { Approval } from "../core/dapps.ts";
import type { Token } from "../core/tokens.ts";
import type { Activity, Preview } from "../core/transactions.ts";
import type { Wallet } from "../core/wallet.ts";
import { button, el, type Field, form } from "./dom.ts";

type View = Awaited<ReturnType<Wallet["view"]>>;
const app = document.getElementById("app") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const brand = document.querySelector(".brand") as HTMLElement;
const accountControl = document.getElementById(
  "account-control",
) as HTMLElement;
let state: View;
let secretTimer: ReturnType<typeof setTimeout> | undefined;
let showingSecret = false;
let busy = false;
let uiGeneration = 0;
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
  const generation = uiGeneration;
  busy = true;
  app.inert = true;
  status.textContent = "Working…";
  status.dataset.state = "loading";
  try {
    await action();
    if (status.textContent === "Working…") status.textContent = "";
    status.dataset.state = "ready";
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "Something went wrong.";
    status.dataset.state = "error";
  } finally {
    busy = false;
    app.inert = false;
    if (generation !== uiGeneration) home();
  }
}
function screen(title?: string) {
  screenId += 1;
  clearTimeout(secretTimer);
  showingSecret = false;
  app.replaceChildren(...(title ? [el("h1", title)] : []));
  brand.hidden = false;
  accountControl.hidden = true;
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
  const generation = uiGeneration;
  const next = await rpc<View>(action, params);
  if (generation !== uiGeneration) return;
  state = next;
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
async function connections() {
  const grants = await rpc<Record<string, string[]>>("connections");
  screen("Connected sites");
  if (!Object.keys(grants).length) app.append(el("p", "No connected sites."));
  for (const [origin, accounts] of Object.entries(grants)) {
    const card = el("section", undefined, "card stack");
    card.append(
      el("h2", origin),
      el("p", accounts.join(", ")),
      button(
        "Disconnect",
        () =>
          attempt(async () => {
            await rpc("revoke", { origin });
            await connections();
          }),
        true,
      ),
    );
    app.append(card);
  }
  back();
}
function approval(item: Approval) {
  screen(
    item.method === "eth_requestAccounts"
      ? "Connect this site?"
      : "Review site request",
  );
  app.append(
    el("h2", item.origin),
    el("p", `${item.method} · chain ${item.chainId}`),
    el("p", item.account, "address"),
  );
  if (item.method === "eth_requestAccounts")
    app.append(
      el(
        "p",
        "This site will see your selected account address. Every signature or transaction still needs your approval.",
      ),
    );
  else if (item.method === "personal_sign")
    app.append(
      el(
        "p",
        "A message signature can grant access or authorize an action. Only sign a message you understand.",
      ),
    );
  else if (item.method === "eth_signTypedData_v4")
    app.append(
      el(
        "p",
        "Typed signatures may grant spending rights. Read every field, especially the spender, amount, and verifying contract.",
      ),
    );
  app.append(
    el(
      "p",
      `Phishing list: ${item.protection.status}. A site not listed can still be malicious.`,
    ),
  );
  if (item.preview) {
    app.append(
      el("p", `To: ${item.preview.to}`),
      el("p", `Amount: ${item.preview.amount} ${item.preview.symbol}`),
      el("p", `Maximum fee: ${item.preview.fee} ${item.preview.symbol}`),
      el("p", `Maximum total: ${item.preview.total} ${item.preview.symbol}`),
    );
    app.append(
      el("p", item.preview.interpretation.summary),
      el("p", item.preview.interpretation.warning),
      el("p", item.preview.simulation.message),
    );
    if (item.preview.interpretation.kind === "approval")
      app.append(
        form(
          [
            {
              key: "amount",
              label: "Allowance in token base units",
              help: "0 revokes allowance. Editing creates a fresh review with the exact new amount.",
            },
          ],
          "Update allowance",
          (values) =>
            attempt(async () => {
              state = await rpc("editDappAllowance", {
                id: item.id,
                amount: values.amount,
              });
              const updated = state.approvals.find(
                (value) => value.id === item.id,
              );
              if (updated) approval(updated);
              else home();
            }),
        ),
      );
  }
  if (item.method === "personal_sign") {
    try {
      const hex = String(item.params[0]).slice(2);
      const bytes = Uint8Array.from(hex.match(/.{2}/g) ?? [], (value) =>
        Number.parseInt(value, 16),
      );
      app.append(el("pre", new TextDecoder().decode(bytes), "secret"));
    } catch {}
  }
  const details = el("details");
  details.append(
    el("summary", "Exact request details"),
    el("pre", JSON.stringify(item.params, null, 2), "secret"),
  );
  app.append(details);
  app.append(
    button(
      item.method === "eth_requestAccounts" ? "Connect" : "Approve request",
      () => attempt(() => command("approveDapp", { id: item.id })),
    ),
    button(
      "Reject request",
      () => attempt(() => command("rejectDapp", { id: item.id })),
      true,
    ),
  );
}
function settings() {
  screen("Settings");
  app.append(
    el(
      "p",
      `Phishing protection: ${state.protection.status}. Last update: ${state.protection.updatedAt ? new Date(state.protection.updatedAt).toLocaleString() : "never"}. Checks run locally.`,
    ),
    button(
      "Update phishing list",
      () =>
        attempt(async () => {
          await rpc("updateProtection");
          state = await rpc("state");
          settings();
        }),
      true,
    ),
    el(
      "small",
      "Updates fetch the MIT-licensed PhishDestroy list from GitHub. No visited domains are sent. Refresh daily; lists older than 24 hours are marked stale.",
    ),
  );
  app.append(
    button("Connected sites", () => attempt(() => connections()), true),
  );
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
  app.append(
    el("p", preview.interpretation.summary),
    el("p", preview.interpretation.warning),
    el("p", preview.simulation.message),
  );
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
async function tokens() {
  const items = await rpc<Token[]>("tokens");
  screen("Tokens");
  if (!items.length) app.append(el("p", "No tokens imported on this network."));
  for (const token of items) {
    const card = el("section", undefined, "card stack");
    card.append(
      el("h2", `${token.name} (${token.symbol})`),
      el("p", token.address, "address"),
    );
    const balance = el("p", "Balance not loaded");
    card.append(
      balance,
      button(
        "Refresh token balance",
        () =>
          attempt(async () => {
            const result = await rpc<{ balance: string; symbol: string }>(
              "tokenBalance",
              { address: token.address },
            );
            balance.textContent = `${result.balance} ${result.symbol}`;
          }),
        true,
      ),
    );
    card.append(
      button(`Send ${token.symbol}`, () =>
        fields(
          `Send ${token.symbol}`,
          [
            { key: "to", label: "Recipient address" },
            {
              key: "amount",
              label: "Token amount",
              help: `${token.decimals} decimal places.`,
            },
          ],
          "Review token transfer",
          async (values) =>
            review(
              await rpc<Preview>("prepareTokenSend", {
                ...values,
                address: token.address,
              }),
            ),
        ),
      ),
      button(
        "Remove token",
        () =>
          attempt(async () => {
            await rpc("removeToken", { address: token.address });
            await tokens();
          }),
        true,
      ),
    );
    app.append(card);
  }
  app.append(
    button("Import token", () =>
      fields(
        "Import token",
        [
          {
            key: "address",
            label: "Token contract address",
            help: "Check the address independently. Names and symbols are untrusted.",
          },
        ],
        "Verify and import",
        async (values) => {
          await rpc("importToken", values);
          await tokens();
        },
      ),
    ),
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
  const quickLock = document.getElementById("quick-lock");
  if (quickLock) quickLock.hidden = vault.state !== "unlocked";
  if (vault.state === "not-created") {
    screen("Ethereum wallet");
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
    screen();
    brand.hidden = true;
    accountControl.hidden = false;
    const select = el("select");
    select.setAttribute("aria-label", "Account");
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
    accountControl.replaceChildren(select);
    const account = vault.accounts[vault.selected];
    if (account) {
      const address = button(account.address, () =>
        attempt(async () => {
          await navigator.clipboard.writeText(account.address);
          status.textContent = "Address copied.";
        }),
      );
      address.className = "address address-copy";
      address.title = "Copy address";
      address.setAttribute("aria-label", `Copy address ${account.address}`);
      app.append(address);
    }
    for (const item of state.approvals)
      app.append(button(`Review ${item.origin}`, () => approval(item)));
    const networkLabel = el("label", "Network", "stack field");
    const networkSelect = el("select");
    networkSelect.setAttribute("aria-label", "Network");
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
    if (account) {
      const balance = el("p", "Loading balance…", "balance");
      app.append(balance);
      const currentScreen = screenId;
      let refreshing = false;
      const refresh = async () => {
        if (refreshing) return;
        refreshing = true;
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
        } finally {
          refreshing = false;
        }
      };
      const actions = el("div", undefined, "action-grid");
      actions.append(
        button("Refresh balance", refresh, true),
        button("Receive", () => receive(), true),
        button("Send", () => send()),
        button("Activity", () => attempt(() => activity()), true),
        button("Tokens", () => attempt(() => tokens()), true),
        button("Settings", () => settings(), true),
      );
      app.append(actions);
      void refresh();
    }
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
      if (
        next.vault.state !== state.vault.state ||
        JSON.stringify(next.approvals.map((item) => item.id)) !==
          JSON.stringify(state.approvals.map((item) => item.id))
      ) {
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

document.getElementById("quick-lock")?.addEventListener("click", () => {
  uiGeneration += 1;
  clearTimeout(secretTimer);
  showingSecret = false;
  app.replaceChildren(el("p", "Locking…"));
  void rpc<View>("lock")
    .then((next) => {
      state = next;
      home();
    })
    .catch(() => {
      status.textContent =
        "Could not confirm locking. Close the browser to end the session.";
    });
});
