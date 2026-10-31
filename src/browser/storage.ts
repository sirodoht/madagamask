import { UserError } from "../core/validation.ts";
import type { Storage } from "../core/vault.ts";

type Area = Pick<chrome.storage.StorageArea, "get" | "set" | "remove"> & {
  setAccessLevel?: chrome.storage.StorageArea["setAccessLevel"];
};

export function extensionStorage(
  area: Area,
  requireIsolation = false,
): Storage {
  const access = Promise.resolve().then(() => {
    if (area.setAccessLevel)
      return area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    if (requireIsolation)
      throw new UserError("This browser cannot isolate wallet storage.");
  });
  // Keep the failure available to every operation without an unhandled rejection.
  void access.catch(() => {});
  return {
    get: async (key) => {
      await access;
      return (await area.get(key))[key];
    },
    set: async (key, value) => {
      await access;
      await area.set({ [key]: value });
    },
    remove: async (key) => {
      await access;
      await area.remove(key);
    },
  };
}
