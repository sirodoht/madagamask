// Public wallet state only. Future vault secrets must never enter this type.
export interface WalletStatus {
  state: "not-created";
}

export function getWalletStatus(): WalletStatus {
  return { state: "not-created" };
}
