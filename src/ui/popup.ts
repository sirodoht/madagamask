import type { ActivityView } from "../core/activity.ts";
import type { Approval } from "../core/dapps.ts";
import {
  messageContent,
  readTypedData,
  signatureDeadline,
  spendingPermission,
} from "../core/signing.ts";
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
let isApprovalWindow = false;

async function rpc<T = View>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const generation = uiGeneration;
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { version: 1, type: "app:command", action, params },
      (response: { ok: boolean; value?: T; error?: string } | undefined) => {
        const disconnected = chrome.runtime.lastError || !response;
        if (generation !== uiGeneration) {
          reject(
            new Error(
              "Wallet context changed. Try again from the current screen.",
            ),
          );
          return;
        }
        if (disconnected || !response?.ok)
          reject(
            new Error(
              response?.error ??
                (["approveSend", "approveDapp"].includes(action)
                  ? "Wallet connection interrupted. Check Activity before sending again."
                  : "Could not reach the wallet. Reopen the extension and try again."),
            ),
          );
        else resolve(response.value as T);
      },
    );
  });
}
async function attempt(
  action: () => Promise<void>,
  showProgress = false,
  feedback = status,
) {
  if (busy) return;
  const generation = uiGeneration;
  const currentScreen = screenId;
  busy = true;
  app.inert = true;
  status.textContent = showProgress ? "Working…" : "";
  if (feedback !== status) feedback.textContent = "";
  status.dataset.state = "loading";
  try {
    await action();
    if (generation !== uiGeneration) return;
    if (status.textContent === "Working…") status.textContent = "";
    status.dataset.state = "ready";
  } catch (error) {
    if (generation !== uiGeneration) return;
    if (feedback === status && currentScreen !== screenId) return;
    feedback.textContent =
      error instanceof Error ? error.message : "Something went wrong.";
    status.dataset.state = "error";
  } finally {
    if (generation === uiGeneration) {
      busy = false;
      app.inert = false;
    }
  }
}
function interrupt() {
  uiGeneration += 1;
  busy = false;
  app.inert = false;
}
function screen(title?: string) {
  screenId += 1;
  clearTimeout(secretTimer);
  clearTimeout(copyTimer);
  showingSecret = false;
  status.textContent = "";
  app.replaceChildren(...(title ? [el("h1", title)] : []));
  brand.hidden = false;
  accountControl.hidden = true;
  accountControl.replaceChildren();
  accountAddress.hidden = true;
  accountAddress.replaceChildren();
  app.setAttribute("aria-busy", "false");
  app.removeAttribute("aria-label");
  if (state?.vault.state === "unlocked") accountHeader();
}
function back(destination: () => void = home) {
  app.append(button("Back", destination, true));
}
function walletForm(
  inputs: Field[],
  label: string,
  action: (values: Record<string, string>) => Promise<void>,
) {
  const error = transferError();
  const body = form(inputs, label, (values) =>
    attempt(() => action(values), false, error),
  );
  body.insertBefore(error, body.lastElementChild);
  body.addEventListener("input", () => {
    error.textContent = "";
  });
  return body;
}
function fields(
  title: string,
  inputs: Field[],
  label: string,
  action: (values: Record<string, string>) => Promise<void>,
  returnTo: () => void = home,
) {
  screen(title);
  const body = walletForm(inputs, label, action);
  const submit = body.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement;
  const actions = el("div", undefined, "action-grid");
  actions.append(button("Back", returnTo, true), submit);
  body.append(actions);
  app.append(body);
}
async function command(
  action: string,
  params: Record<string, unknown> = {},
  destination: () => void = home,
) {
  const generation = uiGeneration;
  const currentScreen = screenId;
  const next = await rpc<View>(action, params);
  if (generation !== uiGeneration) return;
  state = next;
  if (currentScreen === screenId) destination();
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
    importing ? "Import wallet" : "Create wallet",
    async (values) => {
      if (values.password !== values.confirm)
        throw new Error("Passwords do not match.");
      await command(importing ? "import" : "create", {
        password: values.password,
        ...(importing ? { secret: values.phrase, kind } : {}),
      });
    },
    importing ? importWallet : home,
  );
}
const walletLabels: Record<WalletKind, string> = {
  mnemonic: "Mnemonic",
  seed: "Seed",
  privateKey: "Private key",
};
function walletKindIcon(kind: WalletKind) {
  const descriptions: Record<WalletKind, string> = {
    mnemonic:
      "Mnemonic: recovery words that restore this wallet and its derived accounts.",
    seed: "Seed: root seed data that restores this wallet and its derived accounts.",
    privateKey:
      "Private key: a single key that restores this wallet’s one account.",
  };
  const paths: Record<WalletKind, string[]> = {
    mnemonic: ["M6 3h9l3 3v15H6Z", "M9 8h6M9 12h6M9 16h4"],
    seed: [
      "M12 21v-8",
      "M12 13C5 13 3 9 3 5c6 0 9 3 9 8Z",
      "M12 16c0-7 3-10 9-10 0 6-3 10-9 10Z",
    ],
    privateKey: [
      "M11 11l10 10M17 17l3-3M14 14l3-3",
      "M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
    ],
  };
  const icon = el("span", undefined, "wallet-kind");
  icon.tabIndex = 0;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", walletLabels[kind]);
  const tooltip = el("span", descriptions[kind], "wallet-kind-tooltip");
  tooltip.id = `wallet-kind-${crypto.randomUUID()}`;
  tooltip.setAttribute("role", "tooltip");
  icon.setAttribute("aria-describedby", tooltip.id);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const data of paths[kind]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  icon.append(svg, tooltip);
  return icon;
}
function addAccount(wallet: PublicWallet, returnTo: () => void = home) {
  fields(
    `Add account · ${wallet.name}`,
    [{ key: "name", label: "Account name" }],
    "Add account",
    (values) =>
      command("addAccount", { ...values, walletId: wallet.id }, returnTo),
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
  const trigger = button("⋯", () => {}, true);
  trigger.popoverTargetElement = menu;
  trigger.popoverTargetAction = "toggle";
  trigger.className = "row-menu-trigger";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", menu.id);
  trigger.setAttribute("aria-expanded", "false");
  const items = actions.map(([name, run], index) => {
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
    item.autofocus = index === 0;
    return item;
  });
  menu.append(...items);
  menu.addEventListener("beforetoggle", (event) => {
    trigger.setAttribute(
      "aria-expanded",
      String((event as ToggleEvent).newState === "open"),
    );
    if ((event as ToggleEvent).newState !== "open") return;
    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(176, innerWidth - 16);
    menu.style.left = `${Math.max(8, Math.min(bounds.right - width, innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, innerHeight - items.length * 44 - 18))}px`;
  });
  menu.addEventListener("toggle", () => {
    if (!menu.matches(":popover-open")) return;
    const bounds = trigger.getBoundingClientRect();
    menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, innerHeight - menu.getBoundingClientRect().height - 8))}px`;
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
function accountHeader(onSelect: () => void = wallets) {
  const vault = state.vault;
  brand.hidden = true;
  accountControl.hidden = false;
  const account = vault.accounts[vault.selected];
  const select = button(account?.name ?? "Account", onSelect, true);
  const selectedLabel = el("span", account?.name ?? "Account", "account-name");
  selectedLabel.id = "selected-account-label";
  const actionLabel = el(
    "span",
    onSelect === wallets ? "Switch account" : "Back to account",
    "account-switch-label",
  );
  actionLabel.id = "account-switch-label";
  select.replaceChildren(selectedLabel, actionLabel);
  select.classList.add("account-toggle");
  select.setAttribute("aria-label", "Account");
  select.setAttribute(
    "aria-describedby",
    `${selectedLabel.id} ${actionLabel.id}`,
  );
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
    const copyIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    copyIcon.classList.add("address-copy-icon");
    copyIcon.setAttribute("viewBox", "0 0 24 24");
    copyIcon.setAttribute("fill", "none");
    copyIcon.setAttribute("stroke", "currentColor");
    copyIcon.setAttribute("stroke-width", "1.7");
    copyIcon.setAttribute("stroke-linejoin", "round");
    copyIcon.setAttribute("aria-hidden", "true");
    const squares = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    squares.setAttribute("d", "M8 8h12v12H8ZM16 8V4H4v12h4");
    copyIcon.append(squares);
    address.append(value, feedback, copyIcon);
    address.title = "Copy address";
    address.setAttribute("aria-label", `Copy address ${account.address}`);
    accountAddress.hidden = false;
    accountAddress.replaceChildren(address);
  }
  return account;
}
function wallets() {
  screen();
  const returnHome = () => {
    home();
    accountControl.querySelector("button")?.focus();
  };
  accountHeader(returnHome);
  app.setAttribute("aria-label", "Accounts");
  for (const wallet of state.vault.wallets) {
    const group = el("section", undefined, "wallet-group");
    group.setAttribute("aria-label", wallet.name);
    const heading = el("div", undefined, "wallet-row");
    const title = el("div", undefined, "wallet-title");
    title.append(el("h2", wallet.name), walletKindIcon(wallet.kind));
    const walletActions: [string, () => void][] = [
      ["Rename wallet", () => renameWallet(wallet, wallets)],
      ["Back up wallet", () => backup(wallet)],
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
  back(returnHome);
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
      (values) => command("addWallet", { ...values, kind }, returnTo),
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
function backup(wallet: PublicWallet, returnTo: () => void = wallets) {
  fields(
    `Back up ${wallet.name}`,
    [{ key: "password", label: "Password", type: "password" }],
    "Reveal backup",
    async (values) => {
      const currentScreen = screenId;
      const { secret } = await rpc<{ secret: string }>("reveal", {
        password: values.password,
        walletId: wallet.id,
      });
      if (screenId !== currentScreen) return;
      screen(`${wallet.name} · ${walletLabels[wallet.kind]}`);
      showingSecret = true;
      app.append(el("pre", secret, "secret"));
      if (!wallet.backedUp) {
        app.append(
          walletForm(
            [
              {
                key: "phrase",
                label: "Confirm your recovery phrase",
                type: "textarea",
              },
            ],
            "Confirm backup",
            (values) =>
              command(
                "confirmBackup",
                { ...values, walletId: wallet.id },
                returnTo,
              ),
          ),
        );
      }
      back(returnTo);
      secretTimer = setTimeout(returnTo, 60_000);
    },
    returnTo,
  );
}
async function connections() {
  const currentScreen = screenId;
  const grants = await rpc<Record<string, string[]>>("connections");
  if (screenId !== currentScreen) return;
  screen("Connected sites");
  if (!Object.keys(grants).length) app.append(el("p", "No connected sites."));
  for (const [origin, accounts] of Object.entries(grants)) {
    const card = el("section", undefined, "connection-card stack");
    card.append(
      el("h2", origin),
      ...accounts.map((account) => el("p", account, "address")),
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
function approvalCard(title: string, rows: [string, string][]) {
  const card = el("section", undefined, "approval-card");
  card.setAttribute("aria-label", title);
  card.append(el("h2", title));
  const list = el("dl");
  for (const [label, value] of rows) {
    const row = el("div");
    row.append(
      el("dt", label),
      el(
        "dd",
        value,
        /^0x[0-9a-fA-F]{40}$/.test(value) ? "approval-address" : "",
      ),
    );
    list.append(row);
  }
  card.append(list);
  return card;
}
function approvalNotice(text: string) {
  return el("p", text, "approval-notice");
}
function technicalDetails(item: Approval) {
  const rows: [string, string][] = [["Method", item.method]];
  if (item.method === "personal_sign")
    rows.push(
      ["Message bytes", String(item.params[0])],
      ["Signing address", String(item.params[1])],
    );
  else if (item.method === "eth_signTypedData_v4")
    rows.push(
      ["Signing address", String(item.params[0])],
      [
        "Typed data",
        JSON.stringify(
          typeof item.params[1] === "string"
            ? JSON.parse(item.params[1])
            : item.params[1],
          null,
          2,
        ),
      ],
    );
  else if (item.params.length)
    rows.push([
      item.method === "eth_sendTransaction" ? "Transaction" : "Network request",
      JSON.stringify(item.params[0], null, 2),
    ]);
  const details = el("details", undefined, "transfer-details");
  details.append(el("summary", "Technical details"));
  const card = el("div", undefined, "approval-card technical-fields");
  const list = el("dl");
  for (const [label, value] of rows) {
    const row = el("div");
    const heading = el("dt", label);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const copy = button(
      "Copy",
      async () => {
        clearTimeout(timer);
        try {
          await navigator.clipboard.writeText(value);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Try again";
        }
        if (copy.isConnected)
          timer = setTimeout(() => {
            copy.textContent = "Copy";
          }, 2000);
      },
      true,
    );
    copy.classList.add("technical-copy");
    copy.setAttribute("aria-label", `Copy ${label.toLowerCase()}`);
    copy.setAttribute("aria-live", "polite");
    heading.append(copy);
    const content = el("dd", value);
    content.tabIndex = 0;
    row.append(heading, content);
    list.append(row);
  }
  card.append(list);
  details.append(card);
  return details;
}
function approval(item: Approval) {
  const permission =
    item.method === "eth_signTypedData_v4"
      ? spendingPermission(item.params[1])
      : undefined;
  const intent = item.preview?.interpretation;
  const onchainAllowance = intent?.kind === "approval";
  let title = "Review site request";
  let action = "Approve request";
  if (item.method === "eth_requestAccounts") {
    title = "Connect this site?";
    action = "Connect";
  } else if (item.method === "personal_sign") {
    title = "Sign message";
    action = "Sign message";
  } else if (item.method === "eth_signTypedData_v4") {
    title = permission ? "Sign spending permission" : "Sign structured data";
    action = title;
  } else if (item.preview) {
    title = onchainAllowance
      ? "Review spending approval"
      : "Review transaction";
    action = onchainAllowance
      ? "Approve spending"
      : intent?.kind === "unknown"
        ? "Send contract transaction"
        : "Send transaction";
  } else if (item.method === "wallet_switchEthereumChain") {
    title = "Switch network";
    action = "Switch network";
  } else if (item.method === "wallet_addEthereumChain") {
    title = "Add network";
    action = "Add network";
  }
  screen(title);
  const account = state.vault.accounts.find(
    (account) => account.address.toLowerCase() === item.account.toLowerCase(),
  );
  const network = state.networks.items.find(
    (network) => network.id === item.chainId,
  );
  app.append(
    approvalCard("Requesting site", [
      ["Website", item.origin],
      ["Signing account", `${account?.name ?? "Account"} · ${item.account}`],
      [
        "Network",
        `${network?.name ?? "Unknown network"} · chain ${item.chainId}`,
      ],
    ]),
  );
  if (item.method === "eth_requestAccounts")
    app.append(
      el(
        "p",
        "This site will see this account’s address. Signatures and transactions still require separate approval.",
        "request-note",
      ),
    );
  if (item.method === "personal_sign") {
    const message = messageContent(item.params[0]);
    app.append(
      approvalNotice(
        message.readable
          ? "A message signature can authorize actions or access. It can be used outside the selected network."
          : "Unreadable message: these bytes cannot be displayed as plain text without hiding or replacing characters. We couldn’t interpret this request.",
      ),
    );
    app.append(
      approvalCard(
        message.readable ? "Complete message" : "Exact message bytes",
        [[message.readable ? "Message" : "Hexadecimal bytes", message.text]],
      ),
    );
    if (!message.readable) action = "Sign unreadable message";
    app.append(
      el(
        "p",
        "Signing creates a signature for the site. It does not send a transaction or charge a network fee now.",
        "request-note",
      ),
    );
  }
  if (item.method === "eth_signTypedData_v4") {
    const data = readTypedData(item.params[1]);
    const text = (value: unknown) =>
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const domainLabels: Record<string, string> = {
      name: "Application (site supplied)",
      version: "Version",
      verifyingContract: "Verifying contract",
      chainId: "Signed chain ID",
      salt: "Domain salt",
    };
    const domainCard = approvalCard("Application and contract", [
      ["Message type", data.primaryType],
      ...Object.entries(data.domain).map(([key, value]): [string, string] => [
        domainLabels[key] ?? key,
        text(value),
      ]),
      ...(data.domain.verifyingContract === undefined
        ? [["Verifying contract", "Not supplied"] as [string, string]]
        : []),
    ]);
    if (data.domain.chainId === undefined)
      app.append(
        approvalNotice(
          "No chain ID in the signature domain. The selected network does not restrict where this signature can be used.",
        ),
      );
    if (permission) {
      app.append(
        approvalNotice(
          permission.unlimited
            ? "Unlimited spending"
            : permission.amount === "0"
              ? "Permission sets the allowance to zero"
              : "This signature grants spending permission",
        ),
      );
      app.append(
        approvalCard("Declared spending permission", [
          [
            "Format",
            permission.kind === "erc2612"
              ? "ERC-2612 Permit"
              : "Permit2 PermitSingle",
          ],
          ["Token contract", permission.token],
          ["Spender", permission.spender],
          ...(permission.owner
            ? [["Owner", permission.owner] as [string, string]]
            : []),
          [
            "Allowance",
            permission.unlimited
              ? `Unlimited spending (${permission.amount} token base units)`
              : `${permission.amount} token base units`,
          ],
          ["Signature deadline", signatureDeadline(permission.deadline)],
          [
            "Allowance expiry",
            permission.expiration === undefined
              ? "No automatic expiry"
              : permission.expiration === "0"
                ? "Expires when submitted (0)"
                : signatureDeadline(permission.expiration),
          ],
          ["Nonce", permission.nonce],
        ]),
      );
      if (
        permission.owner &&
        permission.owner.toLowerCase() !== item.account.toLowerCase()
      )
        app.append(
          approvalNotice(
            "The permission owner differs from the signing account.",
          ),
        );
      app.append(
        el(
          "p",
          "This matches a known permission format. The contract’s identity and behavior have not been verified. The site can submit this signature later; signing itself charges no network fee.",
          "request-note",
        ),
      );
      if (permission.kind === "erc2612")
        app.append(
          el(
            "p",
            "The signature deadline limits submission, not the lifetime of an allowance already granted.",
            "request-note",
          ),
        );
    } else
      app.append(
        approvalNotice(
          "We couldn’t interpret this request. These fields may authorize spending or other actions. The application name is supplied by the site.",
        ),
      );
    if (!permission)
      app.append(
        approvalCard(
          "Message fields",
          Object.entries(data.message).map(([key, value]) => [
            key,
            text(value),
          ]),
        ),
      );
    app.append(domainCard);
  }
  if (item.preview) {
    if (onchainAllowance) {
      const amount = intent.allowance as string;
      const unlimited = amount === (2n ** 256n - 1n).toString();
      app.append(
        approvalNotice(
          unlimited
            ? "Unlimited spending"
            : amount === "0"
              ? "Revoke spending permission"
              : "Allow this spender to use your tokens",
        ),
      );
      app.append(
        approvalCard("Declared spending permission", [
          ["Token contract", item.preview.to],
          ["Spender", intent.spender as string],
          [
            "Allowance",
            unlimited
              ? `Unlimited spending (${amount} token base units)`
              : `${amount} token base units`,
          ],
          ["Allowance expiry", "No automatic expiry in this approval"],
        ]),
      );
      app.append(
        el(
          "p",
          "This sends an approval transaction and pays a network fee. It does not transfer these tokens now; the spender can use the allowance later. Decoded intent does not verify the contract’s behavior.",
          "request-note",
        ),
      );
      if (amount === "0") action = "Revoke spending";
    } else if (intent?.kind === "unknown")
      app.append(
        approvalNotice(
          "We couldn’t interpret this request. The contract may move assets or change permissions beyond the native amount shown.",
        ),
      );
    app.append(transactionSummary(item.preview, true));
    app.append(
      approvalCard("Network execution check", [
        ["RPC result", item.preview.simulation.message],
      ]),
    );
    if (!onchainAllowance)
      app.append(
        el(
          "p",
          `${intent?.summary ?? ""} ${intent?.warning ?? ""}`,
          "request-note",
        ),
      );
  }
  if (onchainAllowance || permission) {
    const editor = el("details", undefined, "transfer-details");
    editor.append(el("summary", "Reduce allowance"));
    editor.append(
      walletForm(
        [
          {
            key: "amount",
            label: "Allowance in token base units",
            help: "Use whole base units. 0 requests a zero allowance. Saving creates a new review before you sign.",
          },
        ],
        "Update allowance",
        async (values) => {
          state = await rpc("editDappAllowance", {
            id: item.id,
            amount: values.amount,
          });
          const updated = state.approvals.find(
            (value) =>
              value.origin === item.origin && value.method === item.method,
          );
          if (updated) approval(updated);
          else home();
        },
      ),
    );
    app.append(editor);
  }
  if (
    item.method === "wallet_switchEthereumChain" ||
    item.method === "wallet_addEthereumChain"
  ) {
    app.append(
      approvalCard(
        "Requested network",
        Object.entries(item.params[0] as Record<string, unknown>).map(
          ([key, value]) => [key, JSON.stringify(value, null, 2)],
        ),
      ),
    );
    if (item.method === "wallet_addEthereumChain")
      app.append(
        approvalNotice(
          "This RPC provider will receive your requests and can report misleading balances or transaction results. An existing chain ID replaces its endpoint.",
        ),
      );
  }
  app.append(
    technicalDetails(item),
    el(
      "small",
      `Phishing list: ${item.protection.status}. A site not listed can still be malicious.`,
      "request-note",
    ),
  );
  const actions = el("div", undefined, "action-grid approval-actions");
  actions.append(
    button(
      "Reject request",
      () => attempt(() => command("rejectDapp", { id: item.id })),
      true,
    ),
    button(action, () =>
      attempt(() => command("approveDapp", { id: item.id })),
    ),
  );
  app.append(actions);
}

function settings() {
  screen("Settings");
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
            command(
              "addNetwork",
              { ...values, id: Number(values.id) },
              settings,
            ),
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
            { key: "password", label: "Current password", type: "password" },
            {
              key: "newPassword",
              label: "New password",
              type: "password",
              help: "At least 12 characters.",
            },
          ],
          "Change password",
          (values) => command("changePassword", values, settings),
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
          (values) =>
            command("autoLock", { minutes: Number(values.minutes) }, settings),
          settings,
        ),
      true,
    ),
  );
  actions.append(
    button(
      "Reset all wallets",
      () =>
        fields(
          "Reset all wallets",
          [
            { key: "password", label: "Password", type: "password" },
            {
              key: "confirmation",
              label: "Type DELETE",
              help: "This removes all local wallets and accounts. Make sure you have a backup of each wallet.",
            },
          ],
          "Delete all local wallets",
          (values) => command("reset", values),
          settings,
        ),
      true,
    ),
  );
  back();
}
function transferHeading(title: string, network: string) {
  screen();
  status.textContent = "";
  accountHeader();
  const heading = el("div", undefined, "transfer-heading");
  heading.append(el("h1", title), el("span", network, "network-badge"));
  app.append(heading);
}
function transferError() {
  const error = el("p", "", "transfer-error");
  error.setAttribute("role", "alert");
  return error;
}
function transactionSummary(preview: Preview, showAmount = false) {
  const asset = preview.asset;
  const quantity = `${asset?.amount ?? preview.amount} ${asset?.symbol ?? preview.symbol}`;
  const summary = el("dl", undefined, "transfer-summary");
  const row = (label: string, value: string, className = "") => {
    const item = el("div", undefined, className);
    item.append(el("dt", label), el("dd", value));
    summary.append(item);
  };
  row("Recipient", asset?.recipient ?? preview.to, "transfer-recipient");
  if (showAmount) row("Amount", quantity);
  row("Maximum network fee", `${preview.fee} ${preview.symbol}`);
  row(
    "Maximum total",
    asset
      ? `${quantity} + ${preview.fee} ${preview.symbol}`
      : `${preview.total} ${preview.symbol}`,
    "transfer-total",
  );
  if (asset) {
    const total = summary.querySelector(".transfer-total dd") as HTMLElement;
    total.replaceChildren(
      el("span", quantity),
      el("span", ` + ${preview.fee} ${preview.symbol}`),
    );
  }
  return summary;
}
function review(preview: Preview, edit?: () => void) {
  transferHeading("Review transaction", preview.network);
  const reviewScreen = screenId;
  const asset = preview.asset;
  const quantity = `${asset?.amount ?? preview.amount} ${asset?.symbol ?? preview.symbol}`;
  app.append(el("p", quantity, "transfer-amount"));
  app.append(transactionSummary(preview));
  if (preview.replacement)
    app.append(
      el(
        "p",
        "Replaces a pending transaction. Speed-up or cancellation is not guaranteed.",
        "transfer-note",
      ),
    );
  if (preview.data !== "0x" || preview.simulation.status !== "passed")
    app.append(
      el(
        "p",
        preview.simulation.status !== "passed"
          ? preview.simulation.message
          : preview.interpretation.warning,
        "transfer-note",
      ),
    );
  const details = el("details", undefined, "transfer-details");
  details.append(
    el("summary", "Transaction details"),
    el("p", `From: ${preview.from}`, "address"),
    el("p", `Network: ${preview.network} (chain ${preview.chainId})`),
    ...(asset ? [el("p", `Token contract: ${asset.contract}`, "address")] : []),
    el("p", preview.interpretation.summary),
    el("p", preview.interpretation.warning),
    el("p", preview.simulation.message),
  );
  if (preview.data !== "0x") details.append(el("pre", preview.data, "secret"));
  app.append(details);
  const error = transferError();
  const confirm = button("Confirm and send", () =>
    attempt(async () => {
      error.textContent = "";
      confirm.disabled = true;
      confirm.textContent = "Sending…";
      try {
        const tx = await rpc<Activity>("approveSend", { id: preview.id });
        if (screenId !== reviewScreen) return;
        transferHeading(
          tx.status === "pending"
            ? "Transaction submitted"
            : "Check transaction status",
          preview.network,
        );
        app.append(
          el("p", quantity, "transfer-amount"),
          el("p", tx.error ?? "Pending confirmation.", "transfer-note"),
        );
        const hash = el("details", undefined, "transfer-details");
        hash.append(
          el("summary", "Transaction hash"),
          el("p", tx.hash, "address"),
        );
        app.append(
          hash,
          button(
            "View activity",
            () => attempt(() => activity(true), false),
            true,
          ),
        );
        back();
      } catch (cause) {
        if (screenId !== reviewScreen) return;
        error.textContent =
          cause instanceof Error
            ? cause.message
            : "Could not send. Check Activity before trying again.";
        confirm.textContent = "Review again before sending";
        recovery.hidden = false;
      }
    }, false),
  );
  const actions = el("div", undefined, "action-grid review-actions");
  actions.append(
    button(
      edit ? "Edit" : "Reject",
      () =>
        attempt(async () => {
          await rpc("cancelSend", { id: preview.id });
          if (edit) edit();
          else home();
        }, false),
      true,
    ),
    confirm,
  );
  const recovery = button(
    "View activity",
    () => attempt(() => activity(true), false),
    true,
  );
  recovery.hidden = true;
  app.append(error, actions, recovery);
}
function send(token?: Token, draft: Record<string, string> = {}) {
  const network = state.networks.items.find(
    (item) => item.id === state.networks.selected,
  );
  if (!network) return;
  const symbol = token?.symbol ?? network.symbol;
  transferHeading(`Send ${symbol}`, network.name);
  const balance = el("small", "", "transfer-balance");
  const spinner = el("span", undefined, "balance-spinner");
  spinner.setAttribute("role", "img");
  spinner.setAttribute("aria-label", "Loading available balance");
  balance.append(spinner);
  app.append(balance);
  const currentScreen = screenId;
  const available = token
    ? rpc<{ balance: string; symbol: string }>("tokenBalance", {
        address: token.address,
      })
    : rpc<{ amount: string; symbol: string }>("balance").then((result) => ({
        balance: result.amount,
        symbol: result.symbol,
      }));
  void available
    .then((result) => {
      if (screenId === currentScreen)
        balance.textContent = `Available: ${result.balance} ${result.symbol}`;
    })
    .catch(() => {
      if (screenId === currentScreen)
        balance.textContent = "Balance unavailable";
    });
  const error = transferError();
  const sendForm = form(
    [
      { key: "to", label: "Recipient address", value: draft.to ?? "" },
      {
        key: "amount",
        label: token ? "Token amount" : "Amount",
        value: draft.amount ?? "",
      },
    ],
    token ? "Review token transfer" : "Review transaction",
    (values) =>
      attempt(async () => {
        error.textContent = "";
        const submit = sendForm.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement;
        const label = submit.textContent;
        submit.textContent = "Checking…";
        const clean = {
          to: (values.to ?? "").trim(),
          amount: (values.amount ?? "").trim(),
        };
        try {
          if (!/^0x[0-9a-fA-F]{40}$/.test(clean.to))
            throw new Error("Enter a valid Ethereum recipient address.");
          const decimals = token?.decimals ?? 18;
          if (
            !/^(0|[1-9]\d*)(\.\d+)?$/.test(clean.amount) ||
            (clean.amount.split(".")[1]?.length ?? 0) > decimals
          )
            throw new Error(
              `Enter a decimal amount with at most ${decimals} decimal places.`,
            );
          if (!/[1-9]/.test(clean.amount))
            throw new Error("Enter an amount greater than zero.");
          const preview = await rpc<Preview>(
            token ? "prepareTokenSend" : "prepareSend",
            { ...clean, ...(token ? { address: token.address } : {}) },
          );
          if (screenId !== currentScreen) {
            await rpc("cancelSend", { id: preview.id });
            return;
          }
          review(preview, () => send(token, clean));
        } catch (cause) {
          error.textContent =
            cause instanceof Error
              ? cause.message
              : "Could not prepare the transaction. Try again.";
        } finally {
          submit.textContent = label;
        }
      }, false),
  );
  const recipient = sendForm.querySelector('[name="to"]') as HTMLInputElement;
  sendForm.addEventListener("input", () => {
    error.textContent = "";
  });
  recipient.placeholder = "0x…";
  recipient.classList.add("address");
  const amount = sendForm.querySelector('[name="amount"]') as HTMLInputElement;
  amount.inputMode = "decimal";
  amount.placeholder = "0.00";
  const submit = sendForm.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement;
  const actions = el("div", undefined, "action-grid");
  actions.append(
    button("Back", () => (token ? tokenDetails(token) : home()), true),
    submit,
  );
  sendForm.append(error, actions);
  app.append(sendForm);
}
async function activity(refresh = false) {
  const previousScreen = screenId;
  const items = await rpc<ActivityView[]>("activity");
  if (previousScreen !== screenId) return;
  const account = state.vault.accounts[state.vault.selected];
  const network = state.networks.items.find(
    (item) => item.id === state.networks.selected,
  );
  if (!account || !network) return;
  transferHeading("Activity", network.name);
  const currentScreen = screenId;
  const toolbar = el("div", undefined, "activity-toolbar");
  toolbar.append(el("small", "Sent from this account with Madagamask."));
  const error = transferError();
  const list = el("div", undefined, "activity-list");
  list.setAttribute("aria-live", "polite");
  let loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const matches = (items: ActivityView[]) =>
    items.filter(
      (item) =>
        item.chainId === network.id &&
        item.from.toLowerCase() === account.address.toLowerCase(),
    );
  const render = (items: ActivityView[]) => {
    const expanded = new Set(
      [...list.querySelectorAll<HTMLDetailsElement>("details[open]")].map(
        (item) => item.dataset.hash,
      ),
    );
    list.replaceChildren();
    const relevant = matches(items).sort((a, b) => b.createdAt - a.createdAt);
    if (!relevant.length)
      list.append(el("p", "No sent transactions yet.", "activity-empty"));
    for (const item of relevant) {
      const card = el("section", undefined, "activity-card");
      const top = el("div", undefined, "activity-top");
      const badge = el("span", item.display.status, "activity-status");
      badge.dataset.tone = item.display.tone;
      top.append(
        el("h2", `${item.display.title} · ${item.display.amount}`),
        badge,
      );
      const time = el(
        "time",
        new Date(item.createdAt).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      time.dateTime = new Date(item.createdAt).toISOString();
      card.append(
        top,
        el("p", `To ${item.display.recipient}`, "address activity-recipient"),
        time,
      );
      if (item.display.note)
        card.append(el("p", item.display.note, "transfer-note"));
      const details = el("details", undefined, "transfer-details");
      details.dataset.hash = item.hash;
      details.open = expanded.has(item.hash);
      details.append(el("summary", "Details"), el("p", item.hash, "address"));
      if (item.data !== "0x")
        details.append(el("p", `Contract: ${item.to}`, "address"));
      if (item.display.explorer) {
        const link = el("a", "View transaction ↗", "activity-link");
        link.href = item.display.explorer;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        details.append(link);
      }
      if (["pending", "unknown", "unseen"].includes(item.status)) {
        const actions = el("div", undefined, "action-grid");
        for (const cancel of [false, true])
          actions.append(
            button(
              cancel ? "Cancel transaction" : "Speed up",
              () =>
                attempt(
                  async () =>
                    review(
                      await rpc<Preview>("replaceTransaction", {
                        hash: item.hash,
                        cancel,
                      }),
                    ),
                  false,
                ),
              true,
            ),
          );
        details.append(actions);
      }
      card.append(details);
      list.append(card);
    }
    clearTimeout(timer);
    if (
      relevant.some((item) =>
        ["pending", "submitting", "unknown", "unseen"].includes(item.status),
      )
    )
      timer = setTimeout(() => {
        if (screenId === currentScreen && !document.hidden) void load();
      }, 10000);
  };
  const load = async () => {
    if (loading || screenId !== currentScreen) return;
    loading = true;
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    refreshButton.textContent = "";
    const spinner = el("span", undefined, "balance-spinner");
    refreshButton.append(spinner);
    refreshButton.setAttribute("aria-label", "Refreshing activity");
    error.textContent = "";
    try {
      const updated = await rpc<ActivityView[]>("refreshActivity");
      if (screenId === currentScreen) render(updated);
    } catch (cause) {
      error.textContent =
        cause instanceof Error ? cause.message : "Could not refresh activity.";
    } finally {
      loading = false;
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
      refreshButton.textContent = "↻";
      refreshButton.setAttribute("aria-label", "Refresh activity");
    }
  };
  const refreshButton = button("↻", load, true);
  refreshButton.className = "activity-refresh";
  refreshButton.setAttribute("aria-label", "Refresh activity");
  toolbar.append(refreshButton);
  app.append(toolbar, error, list);
  back();
  render(items);
  if (refresh || matches(items).length) void load();
}
function tokenIcon(token: Token) {
  const icon = el(
    "span",
    Array.from(token.symbol).slice(0, 2).join("").toUpperCase(),
    "token-icon",
  );
  icon.style.backgroundColor =
    ["#e6eee0", "#e2eaf2", "#eee3f0"][
      Number.parseInt(token.address.slice(-2), 16) % 3
    ] ?? "#e6eee0";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}
function tokenLoading(target: HTMLElement) {
  target.dataset.state = "loading";
  const spinner = el("span", undefined, "balance-spinner");
  spinner.setAttribute("role", "img");
  spinner.setAttribute("aria-label", "Loading token balance");
  target.replaceChildren(spinner);
}
async function tokenBalance(
  token: Token,
  target: HTMLElement,
  showSymbol = false,
) {
  if (target.dataset.fetching === "true") return;
  target.dataset.fetching = "true";
  const currentScreen = screenId;
  const account = state.vault.accounts[state.vault.selected];
  tokenLoading(target);
  try {
    const result = await rpc<Awaited<ReturnType<Wallet["tokens"]["balance"]>>>(
      "tokenBalance",
      { address: token.address },
    );
    if (screenId !== currentScreen) return;
    if (
      result.address !== account?.address ||
      result.chainId !== token.chainId ||
      result.token !== token.address
    )
      throw new Error("Token balance context changed.");
    target.textContent =
      result.balance + (showSymbol ? ` ${result.symbol}` : "");
    target.dataset.state = "ready";
    target.title = `${result.balance} ${result.symbol}`;
  } catch {
    if (screenId === currentScreen) {
      target.textContent = "Unavailable";
      target.dataset.state = "error";
      target.title = "Use Refresh balance in the token menu to try again.";
    }
  } finally {
    delete target.dataset.fetching;
  }
}
function tokenMenu(token: Token, refresh: () => void) {
  return actionsMenu(`${token.symbol} actions`, [
    ["Refresh balance", refresh],
    [
      "Remove token",
      () =>
        void attempt(async () => {
          await rpc("removeToken", { address: token.address });
          await tokens();
        }, false),
    ],
  ]);
}
function tokenDetails(token: Token) {
  const network = state.networks.items.find(
    (item) => item.id === token.chainId,
  );
  if (!network) return;
  transferHeading(token.symbol, network.name);
  const hero = el("div", undefined, "token-hero");
  hero.append(tokenIcon(token), el("p", token.name));
  const balance = el("p", undefined, "balance token-detail-balance");
  balance.setAttribute("aria-live", "polite");
  app
    .querySelector(".transfer-heading")
    ?.append(tokenMenu(token, () => void tokenBalance(token, balance, true)));
  const contract = el("section", undefined, "token-contract");
  contract.append(
    el("small", "Contract address"),
    el("p", token.address, "address"),
  );
  const actions = el("div", undefined, "action-grid");
  actions.append(
    button("Back", () => attempt(() => tokens(), false), true),
    button(`Send ${token.symbol}`, () => send(token), true),
  );
  app.append(hero, balance, contract, actions);
  void tokenBalance(token, balance, true);
}
async function tokens() {
  const previousScreen = screenId;
  const items = await rpc<Token[]>("tokens");
  if (screenId !== previousScreen) return;
  const network = state.networks.items.find(
    (item) => item.id === state.networks.selected,
  );
  if (!network) return;
  transferHeading("Tokens", network.name);
  const currentScreen = screenId;
  const list = el("div", undefined, "token-list");
  if (!items.length)
    list.append(
      el("p", "No tokens imported on this network.", "activity-empty"),
    );
  const balances: [Token, HTMLElement][] = [];
  for (const token of items) {
    const row = el("div", undefined, "token-row");
    const open = button("", () => tokenDetails(token), true);
    open.className = "token-open";
    open.setAttribute("aria-label", `Open ${token.name} (${token.symbol})`);
    open.title = token.address;
    const label = el("span", undefined, "token-label");
    label.append(el("strong", token.symbol), el("small", token.name));
    const balance = el("span", undefined, "token-balance");
    balance.id = `token-balance-${token.address}`;
    open.setAttribute("aria-describedby", balance.id);
    balance.setAttribute("aria-live", "polite");
    tokenLoading(balance);
    open.append(tokenIcon(token), label, balance);
    row.append(
      open,
      tokenMenu(token, () => void tokenBalance(token, balance)),
    );
    list.append(row);
    balances.push([token, balance]);
  }
  app.append(
    list,
    button(
      "Import token",
      () => {
        fields(
          "Import token",
          [
            {
              key: "address",
              label: "Token contract address",
              help: `Use the contract address on ${network.name}.`,
            },
          ],
          "Verify and import",
          async (values) => {
            await rpc("importToken", {
              address: (values.address ?? "").trim(),
            });
            await tokens();
          },
          () => void attempt(() => tokens(), false),
        );
        const heading = app.querySelector("h1");
        if (heading) {
          const row = el("div", undefined, "transfer-heading");
          heading.replaceWith(row);
          row.append(heading, el("span", network.name, "network-badge"));
        }
      },
      true,
    ),
  );
  back();
  void (async () => {
    for (const [token, balance] of balances) {
      if (screenId !== currentScreen) break;
      await tokenBalance(token, balance);
    }
  })();
}
async function receive() {
  const account = state.vault.accounts[state.vault.selected];
  const network = state.networks.items.find(
    (item) => item.id === state.networks.selected,
  );
  if (!account || !network) return;
  transferHeading("Receive", network.name);
  const code = el("section", undefined, "receive-code");
  const pending = el("span", undefined, "balance-spinner");
  pending.setAttribute("role", "img");
  pending.setAttribute("aria-label", "Loading QR code");
  code.append(pending);
  app.append(code);
  back();
  const currentScreen = screenId;
  let encodeQR: typeof import("./qr.ts")["default"];
  try {
    const qr = (await import(
      chrome.runtime.getURL("qr.js")
    )) as typeof import("./qr.ts");
    if (screenId !== currentScreen) return;
    encodeQR = qr.default;
  } catch {
    code.replaceChildren(
      el("p", "QR code unavailable. Copy the address above."),
    );
    return;
  }
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
  const context = canvas.getContext("2d");
  if (context) {
    grid.forEach((row, y) => {
      row.forEach((cell, x) => {
        context.fillStyle = cell ? "#000" : "#fff";
        context.fillRect(x * 6, y * 6, 6, 6);
      });
    });
  }
  code.replaceChildren(canvas, el("p", "Scan to receive", "receive-caption"));
}
function importWallet() {
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
}
function balanceAmount(amount: string) {
  const point = amount.indexOf(".");
  const prominent = point < 0 ? amount.length : point + 9;
  const value = el("span", amount.slice(0, prominent), "balance-value");
  const extra = amount.slice(prominent);
  if (extra) value.append(el("span", extra, "balance-extra"));
  return value;
}
function home() {
  const vault = state.vault;
  const quickLock = document.getElementById("quick-lock");
  if (quickLock) quickLock.hidden = vault.state !== "unlocked";
  if (vault.state === "not-created") {
    screen("Ethereum wallet");
    app.append(
      el("p", "Create a wallet or restore an existing one."),
      button("Create wallet", () => onboarding(false)),
      button("Import wallet", importWallet, true),
    );
  } else if (vault.state === "locked") {
    screen("Welcome back");
    app.append(
      walletForm(
        [{ key: "password", label: "Password", type: "password" }],
        "Unlock",
        (values) => command("unlock", values),
      ),
    );
    // Initial rendering can happen while the app is inert during state loading.
    requestAnimationFrame(() =>
      app.querySelector<HTMLInputElement>('input[name="password"]')?.focus(),
    );
  } else {
    const pending = state.approvals[0];
    if (isApprovalWindow && pending) {
      approval(pending);
      return;
    }
    screen();
    const account = accountHeader();
    for (const item of state.approvals)
      app.append(button(`Review ${item.origin}`, () => approval(item)));
    const overview = el("section", undefined, "wallet-overview");
    overview.setAttribute("aria-label", "Balance and network");
    const networkSelect = el("select");
    networkSelect.className = "network-picker";
    networkSelect.setAttribute("aria-label", "Network");
    state.networks.items.forEach((network) => {
      const option = el("option", network.name);
      option.value = String(network.id);
      option.selected = network.id === state.networks.selected;
      networkSelect.append(option);
    });
    networkSelect.addEventListener("change", () => {
      void attempt(
        () => command("selectNetwork", { id: Number(networkSelect.value) }),
        false,
      );
    });
    overview.append(networkSelect);
    app.append(overview);
    if (account) {
      const balance = el("p", undefined, "balance");
      balance.dataset.state = "loading";
      balance.setAttribute("aria-live", "polite");
      const balanceRow = el("div", undefined, "balance-row");
      balanceRow.append(balance);
      overview.append(balanceRow);
      const currentScreen = screenId;
      let refreshing = false;
      const refresh = async () => {
        if (refreshing) return;
        refreshing = true;
        refreshButton.disabled = true;
        balance.dataset.state = "loading";
        const spinner = el("span", undefined, "balance-spinner");
        spinner.setAttribute("role", "img");
        spinner.setAttribute("aria-label", "Loading balance");
        balance.replaceChildren(spinner);
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
          ) {
            balance.replaceChildren(
              balanceAmount(value.amount),
              " ",
              el("span", value.symbol, "balance-symbol"),
            );
            balance.dataset.state = "ready";
          }
        } catch {
          if (currentScreen === screenId) {
            balance.textContent = "Balance unavailable. Refresh to try again.";
            balance.dataset.state = "error";
          }
        } finally {
          refreshing = false;
          refreshButton.disabled = false;
        }
      };
      const refreshButton = button("↻", refresh, true);
      refreshButton.className = "balance-refresh";
      refreshButton.setAttribute("aria-label", "Refresh balance");
      refreshButton.title = "Refresh balance";
      balanceRow.append(refreshButton);
      const actions = el(
        "div",
        undefined,
        "action-grid wallet-primary-actions",
      );
      actions.append(
        button("Send", () => send(), true),
        button("Receive", () => receive(), true),
      );
      const navigation = el("nav", undefined, "wallet-nav");
      navigation.setAttribute("aria-label", "Wallet navigation");
      navigation.append(
        button("Tokens", () => attempt(() => tokens(), false), true),
        button("Activity", () => attempt(() => activity(), false), true),
        button("Settings", () => settings(), true),
      );
      app.append(actions, navigation);
      void refresh();
    }
  }
}
document.getElementById("open-tab")?.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && showingSecret) home();
  if (!document.hidden) void syncState();
});
// Check locks even during a slow request. Ordinary polling preserves form inputs;
// context changes invalidate old callbacks before rendering the new screen.
let syncing = false;
async function syncState() {
  if (syncing || !state || document.hidden) return;
  syncing = true;
  const previous = state;
  try {
    const next = await rpc<View>("state");
    if (state !== previous) return;
    const context = (view: View) =>
      JSON.stringify([
        view.vault.state,
        view.vault.accounts[view.vault.selected]?.address,
        view.networks.items.find(
          (network) => network.id === view.networks.selected,
        ),
      ]);
    if (context(next) !== context(previous)) {
      interrupt();
      state = next;
      home();
    } else if (
      !busy &&
      JSON.stringify(next.approvals.map((item) => item.id)) !==
        JSON.stringify(previous.approvals.map((item) => item.id))
    ) {
      state = next;
      home();
    }
  } catch {
    // A temporary worker restart must not erase an unfinished form.
  } finally {
    syncing = false;
  }
}
setInterval(() => void syncState(), 3_000);
void attempt(async () => {
  isApprovalWindow =
    (await chrome.windows.getCurrent().catch(() => undefined))?.type ===
    "popup";
  state = await rpc("state");
  home();
});

document.getElementById("quick-lock")?.addEventListener("click", () => {
  interrupt();
  const generation = uiGeneration;
  screen();
  brand.hidden = false;
  accountControl.hidden = true;
  accountAddress.hidden = true;
  app.append(el("p", "Locking…"));
  void rpc<View>("lock")
    .then((next) => {
      state = next;
      home();
    })
    .catch(() => {
      if (generation !== uiGeneration) return;
      status.textContent =
        "Could not confirm locking. Close the browser to end the session.";
    });
});
