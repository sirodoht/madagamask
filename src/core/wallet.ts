import { Networks } from "./networks.ts";
import { Transactions } from "./transactions.ts";
import { UserError } from "./validation.ts";
import { type Storage, Vault } from "./vault.ts";

export class Wallet {
  readonly vault: Vault;
  readonly networks: Networks;
  readonly transactions: Transactions;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(storage: Storage) {
    this.vault = new Vault(storage);
    this.networks = new Networks(storage);
    this.transactions = new Transactions(storage, this.vault, this.networks);
  }
  async view() {
    return {
      vault: await this.vault.view(),
      networks: await this.networks.view(),
    };
  }
  run(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (
      [
        "lock",
        "selectAccount",
        "selectNetwork",
        "addNetwork",
        "reset",
      ].includes(action)
    )
      this.transactions.invalidate();
    if (action === "lock") {
      this.vault.lock();
      return this.view();
    }
    const result = this.queue.then(() => this.dispatch(action, params));
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
        await this.vault.create(p.password, p.phrase);
        break;
      case "unlock":
        await this.vault.unlock(p.password);
        break;
      case "reveal":
        return { secret: await this.vault.reveal(p.password, p.index) };
      case "confirmBackup":
        await this.vault.confirmBackup(p.phrase);
        break;
      case "addAccount":
        await this.vault.addAccount(p.name, p.privateKey);
        break;
      case "selectAccount":
        await this.vault.select(p.index);
        break;
      case "renameAccount":
        await this.vault.rename(p.name);
        break;
      case "autoLock":
        await this.vault.autoLock(p.minutes);
        break;
      case "changePassword":
        await this.vault.changePassword(p.password, p.newPassword);
        break;
      case "reset":
        await this.vault.reset(p.password, p.confirmation);
        break;
      default:
        throw new UserError("Unsupported wallet command.");
    }
    return this.view();
  }
}
