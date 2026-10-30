import { UserError } from "./validation.ts";
import { type Storage, Vault } from "./vault.ts";

export class Wallet {
  readonly vault: Vault;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(storage: Storage) {
    this.vault = new Vault(storage);
  }
  async view() {
    return { vault: await this.vault.view() };
  }
  run(action: string, params: Record<string, unknown>): Promise<unknown> {
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
    if (action !== "state") this.vault.touch();
    switch (action) {
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
