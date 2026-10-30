import { getWalletStatus } from "../core/status.ts";
import { parseRequest, type Response } from "../shared/messages.ts";
import { authorize, type Sender } from "./authorize.ts";

export function createHandler(extensionId: string, popupUrl: string) {
  // A fresh identity on every background start lets the prototype detect restarts.
  // It is not an unlock token or persisted session.
  const instanceId = crypto.randomUUID();
  const startedAt = Date.now();

  return (message: unknown, sender: Sender): Response => {
    const request = parseRequest(message);
    if (!request) return { ok: false, error: "INVALID_REQUEST" };
    if (!authorize(request, sender, extensionId, popupUrl)) {
      return { ok: false, error: "UNAUTHORIZED" };
    }
    if (request.type === "content:hello")
      return { ok: true, type: "content:ready" };
    return {
      ok: true,
      type: "app:status",
      wallet: getWalletStatus(),
      instanceId,
      startedAt,
    };
  };
}
