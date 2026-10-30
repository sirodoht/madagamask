import type { Wallet } from "../core/wallet.ts";
import { button, el, type Field, form } from "./dom.ts";

type View = Awaited<ReturnType<Wallet["view"]>>;
const app = document.getElementById("app") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
let state: View;
let secretTimer: ReturnType<typeof setTimeout> | undefined;
let showingSecret = false;
let busy = false;

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
