import { Dapps } from "./dapps.ts";
import { Networks } from "./networks.ts";
import { Phishing, type Snapshot } from "./phishing.ts";
import { Tokens } from "./tokens.ts";
import { Transactions } from "./transactions.ts";
import { text, UserError } from "./validation.ts";
import { type Storage, Vault } from "./vault.ts";

export class Wallet {
  readonly vault: Vault;
  readonly tokens: Tokens;
  readonly phishing: Phishing;
  readonly dapps: Dapps;
  readonly networks: Networks;
  readonly transactions: Transactions;
  readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    storage: Storage,
    bundledPhishing?: () => Promise<Snapshot>,
    sessionStorage?: Storage,
  ) {
    this.vault = new Vault(storage, Date.now, sessionStorage);
    this.ready = this.vault.restoreSession();
    this.networks = new Networks(storage);
    this.transactions = new Transactions(storage, this.vault, this.networks);
    this.dapps = new Dapps(this, storage);
    this.tokens = new Tokens(storage, this.networks);
    this.phishing = new Phishing(storage, bundledPhishing);
  }
  async view() {
    return {
      vault: await this.vault.view(),
      networks: await this.networks.view(),
      approvals: this.dapps.approvals(),
      protection: await this.phishing.view(),
    };
  }
  run(action: string, params: Record<string, unknown>): Promise<unknown> {
    // Lock invalidates in-flight restoration and crypto immediately.
    const epoch = this.vault.generation();
    const result =
      action === "lock"
        ? this.runReady(action, params)
        : this.ready.then(() => {
            if (
              !["state", "activity", "refreshActivity", "connections"].includes(
                action,
              ) &&
              this.vault.generation() !== epoch
            )
              throw new UserError(
                "Wallet locked while the operation was queued.",
              );
            return this.runReady(action, params);
          });
    return result.finally(() => this.vault.flushSession());
  }
  private runReady(
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      [
        "lock",
        "selectAccount",
        "addAccount",
        "addWallet",
        "selectNetwork",
        "addNetwork",
        "reset",
      ].includes(action)
    )
      this.transactions.invalidate();
    if (
      [
        "lock",
        "selectAccount",
        "addAccount",
        "addWallet",
        "selectNetwork",
        "addNetwork",
        "reset",
      ].includes(action)
    )
      this.dapps.invalidate();
    if (action === "lock") {
      this.vault.lock();
      return this.view();
    }
    if (action === "state") return this.view();
    const epoch = this.vault.generation();
    const result = this.queue.then(() => {
      if (
        !["activity", "refreshActivity", "connections"].includes(action) &&
        this.vault.generation() !== epoch
      )
        throw new UserError("Wallet locked while the operation was queued.");
      return this.dispatch(action, params);
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private async dispatch(
    action: string,
    p: Record<string, unknown>,
  ): Promise<unknown> {
    if (!["state", "balance", "activity", "refreshActivity"].includes(action))
      this.vault.touch();
    switch (action) {
      case "updateProtection":
        return this.phishing.update();
      case "tokens":
        return this.tokens.list();
      case "importToken":
        return this.tokens.add(p.address);
      case "removeToken":
        await this.tokens.remove(p.address);
        return this.tokens.list();
      case "tokenBalance":
        return this.tokens.balance(p.address, this.vault.account().address);
      case "prepareTokenSend": {
        const tx = await this.tokens.transfer(p.address, p.to, p.amount);
        return this.transactions.prepare(tx.to, tx.amount, tx.data);
      }
      case "editDappAllowance":
        await this.dapps.editAllowance(p.id, p.amount);
        break;
      case "approveDapp":
        await this.dapps.approve(p.id);
        break;
      case "rejectDapp":
        this.dapps.reject(String(p.id));
        break;
      case "connections":
        return this.dapps.connections();
      case "revoke":
        await this.dapps.revoke(String(p.origin));
        break;
      case "prepareSend":
        return this.transactions.prepare(p.to, p.amount, p.data);
      case "approveSend":
        return this.transactions.approve(p.id);
      case "cancelSend":
        this.transactions.cancel(String(p.id));
        return this.view();
      case "activity":
        return this.transactions.list();
      case "refreshActivity":
        return this.transactions.refresh();
      case "replaceTransaction":
        return this.transactions.replacement(p.hash, p.cancel === true);
      case "balance": {
        const view = await this.vault.view();
        const account = view.accounts[view.selected];
        if (!account) throw new UserError("Unlock the wallet first.");
        return this.networks.balance(account.address);
      }
      case "selectNetwork":
        await this.networks.select(p.id);
        break;
      case "addNetwork":
        await this.networks.add(p);
        break;
      case "state":
        break;
      case "create":
        await this.vault.create(p.password);
        break;
      case "import":
        await this.vault.create(
          p.password,
          text(p.secret ?? p.phrase, "wallet secret", 500),
          p.kind ?? "mnemonic",
        );
        break;
      case "unlock":
        await this.vault.unlock(p.password);
        break;
      case "reveal":
        return {
          secret: await this.vault.reveal(p.password, p.index, p.walletId),
        };
      case "confirmBackup":
        await this.vault.confirmBackup(p.phrase, p.walletId);
        break;
      case "addAccount":
        await this.vault.addAccount(p.name, p.privateKey, p.walletId);
        break;
      case "addWallet":
        await this.vault.addWallet(p.name, p.kind, p.secret);
        break;
      case "renameWallet":
        await this.vault.renameWallet(p.walletId, p.name);
        break;
      case "selectAccount":
        await this.vault.select(p.index);
        break;
      case "renameAccount":
        await this.vault.rename(p.name, p.index);
        break;
      case "autoLock":
        await this.vault.autoLock(p.minutes);
        break;
      case "changePassword":
        await this.vault.changePassword(p.password, p.newPassword);
        break;
      case "reset":
        await this.vault.reset(p.password, p.confirmation, () =>
          this.dapps.clear(),
        );
        break;
      default:
        throw new UserError("Unsupported wallet command.");
    }
    return this.view();
  }
}
