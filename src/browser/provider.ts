// Runs in the website's MAIN world. It has no extension APIs or secrets.
type Listener = (...args: unknown[]) => void;
class MadagamaskProvider {
  readonly isMadagamask = true;
  private listeners = new Map<string, Set<Listener>>();
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private connected = true;
  constructor() {
    window.addEventListener("message", (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        !event.data ||
        event.data.channel !== "madagamask:response"
      )
        return;
      const data = event.data;
      if (
        data.event &&
        ["accountsChanged", "chainChanged", "disconnect", "connect"].includes(
          data.event,
        )
      ) {
        this.emit(data.event, data.value);
        return;
      }
      const item = this.pending.get(data.id);
      if (!item) return;
      this.pending.delete(data.id);
      clearTimeout(item.timer);
      if (data.error)
        item.reject(
          Object.assign(new Error(String(data.error.message)), {
            code: Number(data.error.code),
          }),
        );
      else item.resolve(data.result);
    });
    window.addEventListener("pagehide", () => {
      this.connected = false;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(Object.assign(new Error("Page closed."), { code: 4900 }));
      }
      this.pending.clear();
    });
  }
  isConnected() {
    return this.connected;
  }
  request(args: { method: string; params?: unknown[] }) {
    if (
      !args ||
      typeof args.method !== "string" ||
      args.method.length > 80 ||
      (args.params !== undefined && !Array.isArray(args.params))
    )
      return Promise.reject(
        Object.assign(new Error("Invalid provider request."), { code: -32602 }),
      );
    if (this.pending.size >= 16)
      return Promise.reject(
        Object.assign(new Error("Too many requests."), { code: -32002 }),
      );
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Object.assign(new Error("Wallet request timed out."), { code: 4001 }),
        );
      }, 130_000);
      this.pending.set(id, { resolve, reject, timer });
      window.postMessage(
        {
          channel: "madagamask:request",
          id,
          request: { method: args.method, params: args.params ?? [] },
        },
        location.origin,
      );
    });
  }
  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  removeListener(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  private emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? [])
      try {
        listener(value);
      } catch {
        /* One site listener must not block others. */
      }
  }
}
if (window.top === window) {
  const provider = new MadagamaskProvider();
  const info = Object.freeze({
    uuid: crypto.randomUUID(),
    name: "Madagamask",
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23245c42'/><text x='8' y='24' fill='white' font-size='24'>m</text></svg>",
    rdns: "io.madagamask.wallet",
  });
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  const target = window as unknown as { ethereum?: MadagamaskProvider };
  if (!target.ethereum) target.ethereum = provider;
}
