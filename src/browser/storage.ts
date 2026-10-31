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

const DATABASE = "madagamask";
const STORE = "state";

// Content scripts share a site's origin, so only extension contexts can open
// this database. Unlike storage.local, Firefox offers no access level for it.
export function databaseStorage(): Storage {
  let connection: Promise<IDBDatabase> | undefined;
  const open = () => {
    // Firefox needs this to protect the database from eviction. Chrome's
    // unlimitedStorage permission does that, and its workers lack persist().
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      void navigator.storage.persist?.().catch(() => {});
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        request.result.onclose = () => {
          connection = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        connection = undefined;
        reject(request.error);
      };
    });
    return connection;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const database = await open();
    const transaction = database.transaction(STORE, mode, {
      durability: "strict",
    });
    const request = action(transaction.objectStore(STORE));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    return request.result;
  };
  return {
    get: (key) => run("readonly", (store) => store.get(key)),
    set: async (key, value) => {
      await run("readwrite", (store) => store.put(value, key));
    },
    remove: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
  };
}
