import assert from "node:assert/strict";
import { test } from "node:test";
import { authorize, type Sender } from "../../src/browser/authorize.ts";
import { createHandler } from "../../src/browser/handler.ts";
import { isAppStatus, parseRequest } from "../../src/shared/messages.ts";

const id = "test-extension";
const popup = `chrome-extension://${id}/popup.html`;
const appRequest = { version: 1, type: "app:get-status" } as const;
const contentRequest = { version: 1, type: "content:hello" } as const;
const appSender = { id, url: popup, frameId: 0 };
const contentSender = {
  id,
  url: "http://localhost:8080/",
  origin: "http://localhost:8080",
  tab: { id: 1 },
  frameId: 0,
};

test("only the exact versioned request shapes are accepted", () => {
  assert.deepEqual(parseRequest(appRequest), appRequest);
  assert.deepEqual(parseRequest(contentRequest), contentRequest);
  for (const value of [
    null,
    [],
    "app:get-status",
    {},
    { ...appRequest, version: 2 },
    { ...appRequest, payload: {} },
    { version: 1, type: "wallet:unlock" },
    { type: "app:get-status" },
  ]) {
    assert.equal(parseRequest(value), undefined);
  }
});

test("status is restricted to the exact extension UI, including top-level tab views", () => {
  assert.equal(authorize(appRequest, appSender, id, popup), true);
  assert.equal(
    authorize(appRequest, { ...appSender, tab: { id: 7 } }, id, popup),
    true,
  );
  const rejected: Sender[] = [
    {},
    contentSender,
    { ...appSender, id: "another-extension" },
    { ...appSender, url: `${popup}?spoof=true` },
    { ...appSender, url: `${popup}/other` },
    { ...appSender, url: "https://example.com/popup.html" },
    { ...appSender, frameId: 1 },
    { ...appSender, documentLifecycle: "prerender" },
  ];
  for (const sender of rejected)
    assert.equal(authorize(appRequest, sender, id, popup), false);
});

test("the content handshake requires browser-verified localhost tab identity", () => {
  assert.equal(authorize(contentRequest, contentSender, id, popup), true);
  const rejected: Sender[] = [
    appSender,
    { ...contentSender, tab: undefined },
    { ...contentSender, tab: { id: -1 } },
    { ...contentSender, id: "another-extension" },
    { ...contentSender, frameId: 1 },
    { ...contentSender, frameId: undefined },
    { ...contentSender, origin: "null" },
    { ...contentSender, origin: "https://example.com" },
    { ...contentSender, url: "http://localhost.example.com/" },
    { ...contentSender, url: "file:///tmp/page.html" },
    { ...contentSender, url: "invalid" },
  ];
  for (const sender of rejected)
    assert.equal(authorize(contentRequest, sender, id, popup), false);
});

test("handler rejects payload impersonation and exposes no state to content scripts", () => {
  const handle = createHandler(id, popup);
  assert.deepEqual(
    handle({ ...appRequest, sender: appSender }, contentSender),
    { ok: false, error: "INVALID_REQUEST" },
  );
  assert.deepEqual(handle(appRequest, contentSender), {
    ok: false,
    error: "UNAUTHORIZED",
  });
  assert.deepEqual(handle(contentRequest, contentSender), {
    ok: true,
    type: "content:ready",
  });
  const first = handle(appRequest, appSender);
  assert.ok(isAppStatus(first));
  assert.deepEqual(first.wallet, { state: "not-created" });
  assert.deepEqual(handle(appRequest, appSender), first);
  const restarted = createHandler(id, popup)(appRequest, appSender);
  assert.ok(isAppStatus(restarted));
  assert.notEqual(restarted.instanceId, first.instanceId);
  assert.equal(isAppStatus({ ...first, wallet: { state: "unlocked" } }), false);
  assert.equal(isAppStatus({ ...first, startedAt: Infinity }), false);
});
