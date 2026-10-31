import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recoverMessageAddress,
  recoverTypedDataAddress,
  type TypedDataDefinition,
} from "viem";
import type { Site } from "../../src/core/dapps.ts";
import { Wallet } from "../../src/core/wallet.ts";

const site: Site = {
  origin: "https://example.com",
  tabId: 1,
  documentId: "doc-1",
};
async function setup(networks?: unknown) {
  const map = new Map<string, unknown>();
  if (networks) map.set("networks", networks);
  const wallet = new Wallet({
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, structuredClone(value));
    },
    remove: async (key) => {
      map.delete(key);
    },
  });
  await wallet.run("import", {
    password: "disposable-test-password",
    phrase: "test test test test test test test test test test test junk",
  });
  return wallet;
}
async function pending(wallet: Wallet, request: unknown) {
  let ready = () => {};
  const shown = new Promise<void>((resolve) => {
    ready = resolve;
  });
  wallet.dapps.onRequest = async () => {
    ready();
  };
  const result = wallet.dapps.request(request, site);
  result.catch(() => {});
  await shown;
  const approval = wallet.dapps.approvals()[0];
  assert.ok(approval);
  return { result: () => result, approval };
}
test("sites get no accounts until approval; grants are origin scoped", async () => {
  const wallet = await setup();
  assert.deepEqual(
    await wallet.dapps.request({ method: "eth_accounts" }, site),
    [],
  );
  await assert.rejects(
    wallet.dapps.request({ method: "personal_sign", params: [] }, site),
    /Connect/,
  );
  const request = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: request.approval.id });
  assert.equal(((await request.result()) as string[]).length, 1);
  assert.deepEqual(await wallet.dapps.accounts("https://other.example"), []);
  await wallet.run("revoke", { origin: site.origin });
  assert.deepEqual(await wallet.dapps.accounts(site.origin), []);
});

test("mainnet queues message and typed-data signatures for review", async () => {
  const wallet = await setup();
  await wallet.run("selectNetwork", { id: 1 });
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connect.approval.id });
  const [account] = (await connect.result()) as string[];
  assert.ok(account);
  const message = await pending(wallet, {
    method: "personal_sign",
    params: ["0x6869", account],
  });
  assert.equal(message.approval.chainId, 1);
  const signature = (await Promise.all([
    message.result(),
    wallet.run("approveDapp", { id: message.approval.id }),
  ]).then(([value]) => value)) as `0x${string}`;
  assert.equal(
    await recoverMessageAddress({ message: { raw: "0x6869" }, signature }),
    account,
  );
  const typed = await pending(wallet, {
    method: "eth_signTypedData_v4",
    params: [
      account,
      {
        domain: { name: "Review fixture", chainId: 1 },
        types: { Message: [{ name: "value", type: "uint256" }] },
        primaryType: "Message",
        message: { value: 1 },
      },
    ],
  });
  assert.equal(typed.approval.chainId, 1);
  await wallet.run("rejectDapp", { id: typed.approval.id });
});

test("unsupported networks reject native sends and all supported signature methods", async () => {
  const wallet = await setup({
    version: 1,
    items: [
      {
        id: 137,
        name: "Polygon",
        rpc: "https://polygon.example",
        symbol: "POL",
      },
    ],
    selected: 137,
  });
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connect.approval.id });
  const [account] = (await connect.result()) as string[];
  assert.ok(account);
  await assert.rejects(
    wallet.run("prepareSend", { to: account, amount: "0.001" }),
    /Signing is disabled/,
  );
  for (const request of [
    {
      method: "eth_sendTransaction",
      params: [{ from: account, to: account, value: "0x1", chainId: "0x89" }],
    },
    { method: "personal_sign", params: ["0x6869", account] },
    {
      method: "eth_signTypedData_v4",
      params: [
        account,
        {
          domain: { name: "Review fixture", chainId: 137 },
          types: { Message: [{ name: "value", type: "uint256" }] },
          primaryType: "Message",
          message: { value: 1 },
        },
      ],
    },
  ]) {
    await assert.rejects(
      wallet.dapps.request(request, site),
      /Signing is (disabled|not supported)/,
    );
    assert.deepEqual(wallet.dapps.approvals(), []);
  }
  for (const method of [
    "eth_sign",
    "eth_signTransaction",
    "eth_sendRawTransaction",
    "wallet_sendCalls",
  ])
    await assert.rejects(
      wallet.dapps.request({ method, params: [] }, site),
      /not supported/,
    );
  assert.deepEqual(await wallet.transactions.list(), []);
});
test("message approval binds the original payload; lock rejects pending requests", async () => {
  const wallet = await setup();
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connect.approval.id });
  await connect.result();
  const account = (await wallet.dapps.accounts(site.origin))[0];
  assert.ok(account);
  const params = ["0x68656c6c6f", account];
  const signing = await pending(wallet, { method: "personal_sign", params });
  params[0] = "0x626164";
  await wallet.run("approveDapp", { id: signing.approval.id });
  const signature = await signing.result();
  assert.equal(
    await recoverMessageAddress({
      message: { raw: "0x68656c6c6f" },
      signature: signature as `0x${string}`,
    }),
    account,
  );
  const next = await pending(wallet, {
    method: "personal_sign",
    params: ["0x6869", account],
  });
  await wallet.run("lock", {});
  await assert.rejects(next.result(), /context changed/);
  assert.deepEqual(await wallet.dapps.accounts(site.origin), []);
});
test("unsupported methods, iframes handled by sender guard, and stale pages cannot approve", async () => {
  const wallet = await setup();
  await assert.rejects(
    wallet.dapps.request({ method: "eth_sign", params: [] }, site),
    /not supported/,
  );
  const request = await pending(wallet, { method: "eth_requestAccounts" });
  wallet.dapps.isSiteActive = () => false;
  await assert.rejects(
    wallet.run("approveDapp", { id: request.approval.id }),
    /no longer active/,
  );
  await assert.rejects(request.result(), /no longer active/);
  assert.deepEqual(await wallet.dapps.accounts(site.origin), []);
});

test("queued unlock cannot resurrect a wallet after an immediate lock", async () => {
  const wallet = await setup();
  await wallet.run("lock", {});
  const first = wallet.run("unlock", { password: "disposable-test-password" });
  const second = wallet.run("unlock", { password: "disposable-test-password" });
  const failed1 = assert.rejects(first, /locked/);
  const failed2 = assert.rejects(second, /locked/);
  await wallet.run("lock", {});
  await Promise.all([failed1, failed2]);
  assert.equal((await wallet.view()).vault.state, "locked");
});

test("duplicate requests, cross-account signatures, wrong-chain typed data, and tab closure are rejected", async () => {
  const wallet = await setup();
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await assert.rejects(
    wallet.dapps.request({ method: "eth_requestAccounts" }, site),
    /already pending/,
  );
  await wallet.run("approveDapp", { id: connect.approval.id });
  await connect.result();
  const account = (await wallet.dapps.accounts(site.origin))[0];
  assert.ok(account);
  await assert.rejects(
    wallet.dapps.request(
      {
        method: "personal_sign",
        params: ["0x00", "0x0000000000000000000000000000000000000001"],
      },
      site,
    ),
    /does not match/,
  );
  await assert.rejects(
    wallet.dapps.request(
      {
        method: "eth_signTypedData_v4",
        params: [
          account,
          {
            domain: { chainId: 1 },
            types: { Message: [{ name: "text", type: "string" }] },
            primaryType: "Message",
            message: { text: "test" },
          },
        ],
      },
      site,
    ),
    /another chain/,
  );
  const signing = await pending(wallet, {
    method: "personal_sign",
    params: ["0x00", account],
  });
  wallet.dapps.rejectTab(site.tabId);
  await assert.rejects(signing.result(), /closed or navigated/);
});

test("typed-data approval signs the reviewed domain and message", async () => {
  const wallet = await setup();
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connect.approval.id });
  await connect.result();
  const [account] = await wallet.dapps.accounts(site.origin);
  const data = {
    domain: { name: "Alpha test", version: "1", chainId: 11155111 },
    types: { Message: [{ name: "text", type: "string" }] },
    primaryType: "Message",
    message: { text: "Disposable signing check" },
  } as const;
  const signing = await pending(wallet, {
    method: "eth_signTypedData_v4",
    params: [account, JSON.stringify(data)],
  });
  await wallet.run("approveDapp", { id: signing.approval.id });
  const signature = (await signing.result()) as `0x${string}`;
  assert.equal(
    await recoverTypedDataAddress({
      ...(data as unknown as TypedDataDefinition),
      signature,
    }),
    account,
  );
});

test("dismissal during approval processing prevents signature delivery", async () => {
  const wallet = await setup();
  const connection = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connection.approval.id });
  await connection.result();
  const [account] = await wallet.dapps.accounts(site.origin);
  const signing = await pending(wallet, {
    method: "personal_sign",
    params: ["0x00", account],
  });
  let entered = () => {};
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const check = wallet.phishing.check.bind(wallet.phishing);
  wallet.phishing.check = async (origin) => {
    entered();
    await gate;
    return check(origin);
  };
  const approving = wallet.run("approveDapp", { id: signing.approval.id });
  const rejected = assert.rejects(approving, /dismissed/);
  await reached;
  wallet.dapps.invalidate("Approval window closed.");
  release();
  await rejected;
  await assert.rejects(signing.result(), /window closed/);
});

test("approved network switches resolve and invalidate other reviews", async () => {
  const wallet = await setup();
  const connection = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connection.approval.id });
  await connection.result();
  const switching = await pending(wallet, {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x14a34" }],
  });
  await wallet.run("approveDapp", { id: switching.approval.id });
  assert.equal(await switching.result(), null);
  assert.equal((await wallet.networks.selected()).id, 84532);
});

test("adding a wallet or child account invalidates pending approval and changes account permission context", async () => {
  for (const [action, params] of [
    ["addAccount", { name: "Second", walletId: "wallet-1" }],
    [
      "addWallet",
      { name: "Single", kind: "privateKey", secret: `0x${"44".repeat(32)}` },
    ],
  ] as const) {
    const wallet = await setup();
    const connect = await pending(wallet, { method: "eth_requestAccounts" });
    await wallet.run("approveDapp", { id: connect.approval.id });
    await connect.result();
    const account = (await wallet.dapps.accounts(site.origin))[0];
    const signing = await pending(wallet, {
      method: "personal_sign",
      params: ["0x6869", account],
    });
    await wallet.run(action, params);
    await assert.rejects(signing.result(), /context changed/);
    assert.deepEqual(await wallet.dapps.accounts(site.origin), []);
    assert.equal(wallet.dapps.approvals().length, 0);
  }
});

test("permission reductions invalidate the old review and sign only the revised payload", async () => {
  const { permit, permit2 } = await import("../fixtures/permits.ts");
  const wallet = await setup();
  const connect = await pending(wallet, { method: "eth_requestAccounts" });
  await wallet.run("approveDapp", { id: connect.approval.id });
  await connect.result();
  const [account] = await wallet.dapps.accounts(site.origin);
  for (const data of [permit, permit2]) {
    const signing = await pending(wallet, {
      method: "eth_signTypedData_v4",
      params: [account, JSON.stringify(data)],
    });
    const originalId = signing.approval.id;
    await wallet.run("editDappAllowance", { id: originalId, amount: "7" });
    const revised = wallet.dapps.approvals()[0];
    assert.ok(revised);
    assert.notEqual(revised.id, originalId);
    assert.equal(revised.expiresAt, signing.approval.expiresAt);
    await assert.rejects(
      wallet.run("approveDapp", { id: originalId }),
      /expired or was dismissed/,
    );
    await assert.rejects(
      wallet.run("editDappAllowance", { id: revised.id, amount: "8" }),
      /no greater/,
    );
    assert.equal(wallet.dapps.approvals()[0]?.id, revised.id);
    await wallet.run("approveDapp", { id: revised.id });
    const signature = (await signing.result()) as `0x${string}`;
    const expected = structuredClone(data);
    if (expected.primaryType === "Permit")
      Object.assign(expected.message, { value: "7" });
    else Object.assign(expected.message.details, { amount: "7" });
    assert.equal(
      await recoverTypedDataAddress({
        ...(expected as unknown as TypedDataDefinition),
        signature,
      }),
      account,
    );
    assert.notEqual(
      await recoverTypedDataAddress({
        ...(data as unknown as TypedDataDefinition),
        signature,
      }),
      account,
    );
  }
  await assert.rejects(
    wallet.dapps.request(
      {
        method: "eth_signTypedData_v4",
        params: [
          account,
          { ...permit, types: { ...permit.types, EIP712Domain: [] } },
        ],
      },
      site,
    ),
    /domain fields/,
  );
  assert.equal(wallet.dapps.approvals().length, 0);
});
