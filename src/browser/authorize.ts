import type { Request } from "../shared/messages.ts";

// Only browser-provided MessageSender fields belong here, never page payloads.
export interface Sender {
  id?: string | undefined;
  url?: string | undefined;
  origin?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined } | undefined;
  documentLifecycle?: string | undefined;
}

export function authorize(
  request: Request,
  sender: Sender,
  extensionId: string,
  popupUrl: string,
): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  if (sender.documentLifecycle && sender.documentLifecycle !== "active")
    return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;

  if (request.type === "app:get-status") {
    return sender.url === popupUrl;
  }

  if (
    !Number.isInteger(sender.tab?.id) ||
    (sender.tab?.id ?? -1) < 0 ||
    sender.frameId !== 0
  ) {
    return false;
  }
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (!sender.origin || sender.origin === url.origin)
    );
  } catch {
    return false;
  }
}
