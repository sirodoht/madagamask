import encodeQR from "qr";
import type { Approval } from "../core/dapps.ts";
import type { Token } from "../core/tokens.ts";
import type { Activity, Preview } from "../core/transactions.ts";
import type { PublicWallet, WalletKind } from "../core/vault.ts";
import type { Wallet } from "../core/wallet.ts";
import { button, el, type Field, form } from "./dom.ts";

type View = Awaited<ReturnType<Wallet["view"]>>;
const app = document.getElementById("app") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const brand = document.querySelector(".brand") as HTMLElement;
const accountControl = document.getElementById(
  "account-control",
) as HTMLElement;
const accountAddress = document.getElementById(
  "account-address",
) as HTMLElement;
let state: View;
let secretTimer: ReturnType<typeof setTimeout> | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
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
  clearTimeout(copyTimer);
  showingSecret = false;
  app.replaceChildren(...(title ? [el("h1", title)] : []));
  brand.hidden = false;
  accountControl.hidden = true;
  accountControl.replaceChildren();
  accountAddress.hidden = true;
  accountAddress.replaceChildren();
  app.setAttribute("aria-busy", "false");
}
function back(destination: () => void = home) {
  app.append(button("Back", destination, true));
}
function fields(
  title: string,
  inputs: Field[],
  label: string,
  action: (values: Record<string, string>) => Promise<void>,
  returnTo: () => void = home,
) {
  screen(title);
  app.append(form(inputs, label, (values) => attempt(() => action(values))));
  back(returnTo);
}
async function command(
  action: string,
  params: Record<string, unknown> = {},
  destination: () => void = home,
) {
  const generation = uiGeneration;
  const next = await rpc<View>(action, params);
  if (generation !== uiGeneration) return;
  state = next;
  destination();
}
const passwordField: Field = {
  key: "password",
  label: "Password",
  type: "password",
  help: "At least 12 characters.",
};

function onboarding(importing: boolean, kind: WalletKind = "mnemonic") {
  fields(
    importing ? "Import wallet" : "Create wallet",
    [
      ...(importing
        ? [
            {
              key: "phrase",
              label:
                kind === "mnemonic"
                  ? "Recovery phrase"
                  : kind === "seed"
                    ? "Seed (hexadecimal)"
                    : "Private key",
              type: kind === "mnemonic" ? "textarea" : "password",
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
        ...(importing ? { secret: values.phrase, kind } : {}),
      });
    },
  );
}
const walletLabels: Record<WalletKind, string> = {
  mnemonic: "Mnemonic",
  seed: "Seed",
  privateKey: "Private key",
};
function selectedWallet() {
  const id = state.vault.accounts[state.vault.selected]?.walletId;
  const wallet = state.vault.wallets.find((wallet) => wallet.id === id);
  if (!wallet) throw new Error("Wallet not found.");
  return wallet;
}
function addAccount(wallet: PublicWallet, returnTo: () => void = home) {
  fields(
    `Add account · ${wallet.name}`,
    [{ key: "name", label: "Account name" }],
    "Add account",
    (values) => command("addAccount", { ...values, walletId: wallet.id }),
    returnTo,
  );
}
function renameWallet(wallet: PublicWallet, returnTo: () => void) {
  fields(
    "Rename wallet",
    [{ key: "name", label: "Wallet name", value: wallet.name }],
    "Save name",
    (values) =>
      command("renameWallet", { ...values, walletId: wallet.id }, returnTo),
    returnTo,
  );
}
function actionsMenu(label: string, actions: [string, () => void][]) {
  const wrapper = el("span", undefined, "row-menu");
  const menu = el("div", undefined, "row-menu-popup");
  menu.id = `actions-${crypto.randomUUID()}`;
  menu.popover = "auto";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  const trigger = button(
    "⋯",
    () => {
      menu.togglePopover();
      if (!menu.matches(":popover-open")) return;
      const bounds = trigger.getBoundingClientRect();
      const size = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(bounds.right - size.width, innerWidth - size.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, innerHeight - size.height - 8))}px`;
      items[0]?.focus();
    },
    true,
  );
  trigger.className = "row-menu-trigger";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", menu.id);
  trigger.setAttribute("aria-expanded", "false");
  const items = actions.map(([name, run]) => {
    const item = button(
      name,
      () => {
        menu.hidePopover();
        run();
      },
      true,
    );
    item.className = "account-option";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    return item;
  });
  menu.append(...items);
  menu.addEventListener("beforetoggle", (event) => {
    trigger.setAttribute(
      "aria-expanded",
      String((event as ToggleEvent).newState === "open"),
    );
  });
  menu.addEventListener("keydown", (event) => {
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (["Escape", "Tab"].includes(event.key)) {
      event.preventDefault();
      menu.hidePopover();
      trigger.focus();
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  });
  wrapper.append(trigger, menu);
  return wrapper;
}
function wallets() {
  screen();
  const returnHome = () => {
    home();
    accountControl.querySelector("button")?.focus();
  };
  const top = el("div", undefined, "wallet-screen-heading");
  top.append(button("Back", returnHome, true), el("h1", "Wallets"));
  app.append(top);
  for (const wallet of state.vault.wallets) {
    const group = el("section", undefined, "wallet-group");
    group.setAttribute("aria-label", wallet.name);
    const heading = el("div", undefined, "wallet-row");
    const title = el("div", undefined, "wallet-title");
    title.append(
      el("h2", wallet.name),
      el("span", walletLabels[wallet.kind], "wallet-kind"),
    );
    const walletActions: [string, () => void][] = [
      ["Rename wallet", () => renameWallet(wallet, wallets)],
    ];
    if (wallet.kind !== "privateKey")
      walletActions.push(["Add account", () => addAccount(wallet, wallets)]);
    heading.append(
      title,
      actionsMenu(`Wallet actions for ${wallet.name}`, walletActions),
    );
    group.append(heading);
    state.vault.accounts.forEach((account, index) => {
      if (account.walletId !== wallet.id) return;
      const row = el("div", undefined, "wallet-row account-row");
      const choose = button(
        account.name,
        () =>
          attempt(async () => {
            await command("selectAccount", { index });
            accountControl.querySelector("button")?.focus();
          }),
        true,
      );
      choose.className = "account-option";
      choose.setAttribute(
        "aria-pressed",
        String(index === state.vault.selected),
      );
      choose.setAttribute("aria-label", `Select account ${account.name}`);
      const accountActions = actionsMenu(
        `Account actions for ${account.name}`,
        [
          [
            "Rename account",
            () =>
              fields(
                "Rename account",
                [{ key: "name", label: "Account name", value: account.name }],
                "Save name",
                (values) =>
                  command("renameAccount", { ...values, index }, wallets),
                wallets,
              ),
          ],
        ],
      );
      row.append(choose, accountActions);
      group.append(row);
    });
    app.append(group);
  }
  app.append(button("+ Add wallet", () => addWallet(wallets), true));
}
function addWallet(returnTo: () => void = home) {
  screen("Add wallet");
  const choose = (kind: WalletKind, generate = false) => {
    fields(
      generate ? "Create wallet" : `Import ${walletLabels[kind].toLowerCase()}`,
      [
        { key: "name", label: "Wallet name" },
        ...(generate
          ? []
          : [
              {
                key: "secret",
                label:
                  kind === "mnemonic"
                    ? "Recovery phrase"
                    : kind === "seed"
                      ? "Seed (hexadecimal)"
                      : "Private key",
                type: kind === "mnemonic" ? "textarea" : "password",
              },
            ]),
      ],
      generate ? "Create wallet" : "Import wallet",
      (values) => command("addWallet", { ...values, kind }),
      () => addWallet(returnTo),
    );
  };
  app.append(
    button("Create wallet", () => choose("mnemonic", true), true),
    button("Import mnemonic", () => choose("mnemonic"), true),
    button("Import seed", () => choose("seed"), true),
    button("Import private key", () => choose("privateKey"), true),
  );
  back(returnTo);
}
function backup(wallet = selectedWallet(), returnTo: () => void = settings) {
  fields(
    `Back up ${wallet.name}`,
    [{ key: "password", label: "Password", type: "password" }],
    "Reveal backup",
    async (values) => {
      const { secret } = await rpc<{ secret: string }>("reveal", {
        password: values.password,
        walletId: wallet.id,
      });
      screen(`${wallet.name} · ${walletLabels[wallet.kind]}`);
      showingSecret = true;
      app.append(el("pre", secret, "secret"));
      if (!wallet.backedUp) {
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
            (values) =>
              attempt(() =>
                command("confirmBackup", { ...values, walletId: wallet.id }),
              ),
          ),
        );
      }
      back(returnTo);
      secretTimer = setTimeout(() => home(), 60_000);
    },
    returnTo,
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
  back(settings);
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
  const wallet = selectedWallet();
  app.append(
    el(
      "p",
      `${wallet.name} · ${walletLabels[wallet.kind]}`,
      "settings-account",
    ),
  );
  const actions = el("div", undefined, "action-grid settings-grid");
  app.append(actions);
  actions.append(
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
  );
  actions.append(
    button("Connected sites", () => attempt(() => connections()), true),
  );
  actions.append(
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
          settings,
        ),
      true,
    ),
  );
  actions.append(
    button("Back up wallet", () => backup(wallet), true),
    button("Rename wallet", () => renameWallet(wallet, settings), true),
    button("Add wallet", () => addWallet(settings), true),
  );
  if (wallet.kind !== "privateKey")
    actions.append(
      button("Add account", () => addAccount(wallet, settings), true),
    );
  actions.append(
    button(
      "Rename account",
      () =>
        fields(
          "Rename account",
          [{ key: "name", label: "Account name" }],
          "Save name",
          (values) => command("renameAccount", values),
          settings,
        ),
      true,
    ),
  );
  actions.append(
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
          settings,
        ),
      true,
    ),
  );
  actions.append(
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
          settings,
        ),
      true,
    ),
  );
  actions.append(
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
              help: "This removes all local wallets and accounts. Make sure you have a backup of each wallet.",
            },
          ],
          "Delete local wallet",
          (values) => command("reset", values),
          settings,
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
      button(
        "Import wallet",
        () => {
          screen("Import wallet");
          for (const kind of ["mnemonic", "seed", "privateKey"] as const)
            app.append(
              button(
                `Import ${walletLabels[kind].toLowerCase()}`,
                () => onboarding(true, kind),
                true,
              ),
            );
          back();
        },
        true,
      ),
    );
  } else if (vault.state === "locked") {
    screen("Welcome back");
    app.append(
      form(
        [{ key: "password", label: "Password", type: "password" }],
        "Unlock",
        (values) => attempt(() => command("unlock", values)),
      ),
    );
    // Initial rendering can happen while the app is inert during state loading.
    requestAnimationFrame(() =>
      app.querySelector<HTMLInputElement>('input[name="password"]')?.focus(),
    );
  } else {
    screen();
    brand.hidden = true;
    accountControl.hidden = false;
    const account = vault.accounts[vault.selected];
    const select = button(account?.name ?? "Account", wallets, true);
    const selectedLabel = el(
      "span",
      account?.name ?? "Account",
      "account-name",
    );
    selectedLabel.id = "selected-account-label";
    select.replaceChildren(selectedLabel);
    select.classList.add("account-toggle");
    select.setAttribute("aria-label", "Account");
    select.setAttribute("aria-describedby", selectedLabel.id);
    select.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        wallets();
        app.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      }
    });
    accountControl.replaceChildren(select);
    if (account) {
      const value = el("span", account.address, "address-value");
      const feedback = el("span", "", "address-feedback");
      feedback.setAttribute("aria-live", "polite");
      const address = button("", async () => {
        if (address.disabled) return;
        address.disabled = true;
        clearTimeout(copyTimer);
        try {
          await navigator.clipboard.writeText(account.address);
          feedback.textContent = "Address copied ✓";
        } catch {
          feedback.textContent = "Could not copy. Try again.";
        } finally {
          address.disabled = false;
        }
        if (!address.isConnected) return;
        address.classList.add("show-feedback");
        copyTimer = setTimeout(() => {
          address.classList.remove("show-feedback");
          feedback.textContent = "";
        }, 2000);
      });
      address.className = "address address-copy";
      address.append(value, feedback);
      address.title = "Copy address";
      address.setAttribute("aria-label", `Copy address ${account.address}`);
      accountAddress.hidden = false;
      accountAddress.append(address);
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
        button("Send", () => send(), true),
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
