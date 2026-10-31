import assert from "node:assert/strict";
import { test } from "node:test";
import {
  messageContent,
  readTypedData,
  reducePermission,
  signatureDeadline,
  spendingPermission,
  validateSigningFields,
} from "../../src/core/signing.ts";
import { permit, permit2 } from "../fixtures/permits.ts";

test("exact permit schemas expose amounts, spenders, and distinct submission/allowance deadlines", () => {
  const first = spendingPermission(permit);
  assert.equal(first?.kind, "erc2612");
  assert.equal(first?.unlimited, true);
  assert.equal(first?.token, permit.domain.verifyingContract);
  assert.equal(first?.spender, permit.message.spender);
  assert.equal(first?.expiration, undefined);
  const second = spendingPermission(JSON.stringify(permit2));
  assert.equal(second?.kind, "permit2");
  assert.equal(second?.unlimited, true);
  assert.equal(second?.deadline, "1800000000");
  assert.equal(second?.expiration, "1900000000");
  assert.match(signatureDeadline("0", 1), /expired/);
  assert.match(
    signatureDeadline(permit.message.value),
    /No practical deadline/,
  );
});

test("lookalike or invalid permits remain uninterpreted", () => {
  assert.equal(
    spendingPermission({
      ...permit,
      types: { Permit: [{ name: "spender", type: "address" }] },
    }),
    undefined,
  );
  assert.equal(
    spendingPermission({
      ...permit,
      message: { ...permit.message, extra: "1" },
    }),
    undefined,
  );
  assert.equal(
    spendingPermission({
      ...permit,
      message: { ...permit.message, value: Number.MAX_SAFE_INTEGER + 1 },
    }),
    undefined,
  );
  assert.equal(
    spendingPermission({
      ...permit2,
      message: {
        ...permit2.message,
        details: {
          ...permit2.message.details,
          amount: (2n ** 160n).toString(),
        },
      },
    }),
    undefined,
  );
});

test("reducing a permit preserves every other field, input encoding, and the original payload", () => {
  for (const source of [permit, permit2]) {
    const before = JSON.stringify(source);
    for (const input of [source, before]) {
      const reduced = reducePermission(input, "7");
      assert.equal(typeof reduced, typeof input);
      assert.equal(spendingPermission(reduced)?.amount, "7");
      const expected = structuredClone(source);
      if (expected.primaryType === "Permit")
        Object.assign(expected.message, { value: "7" });
      else Object.assign(expected.message.details, { amount: "7" });
      assert.deepEqual(readTypedData(reduced), expected);
      assert.equal(
        spendingPermission(reducePermission(reduced, "0"))?.amount,
        "0",
      );
      for (const invalid of ["8", "-1", "1.5", "1e2", "0x1", 1])
        assert.throws(() => reducePermission(reduced, invalid));
    }
    assert.equal(JSON.stringify(source), before);
  }
});

test("reviewed domain and nested message fields must actually be signed", () => {
  validateSigningFields(permit);
  validateSigningFields(permit2);
  assert.throws(
    () =>
      validateSigningFields({
        ...permit,
        types: { ...permit.types, EIP712Domain: [] },
      }),
    /domain fields/,
  );
  assert.throws(
    () =>
      validateSigningFields({
        ...permit2,
        message: {
          ...permit2.message,
          details: { ...permit2.message.details, hidden: "1" },
        },
      }),
    /Message fields/,
  );
  assert.throws(
    () =>
      validateSigningFields({
        ...permit,
        message: { ...permit.message, value: Number.MAX_SAFE_INTEGER + 1 },
      }),
    /decimal string/,
  );
  validateSigningFields({
    domain: {},
    types: {
      Batch: [{ name: "items", type: "Item[]" }],
      Item: [{ name: "amount", type: "uint256" }],
    },
    primaryType: "Batch",
    message: { items: [{ amount: "123" }] },
  });
});

test("message review preserves complete UTF-8 and exposes binary or hidden formatting as exact bytes", () => {
  const encode = (value: string) => `0x${Buffer.from(value).toString("hex")}`;
  const text = "Hello\nFull message with emoji 👋 and tabs\there";
  assert.deepEqual(messageContent(encode(text)), {
    readable: true,
    text,
    hex: encode(text),
  });
  for (const hex of [
    "0xff00",
    encode("hello\u202Eworld"),
    encode("\uFEFFhello"),
    encode("yes\u0000no"),
    encode("pay\u061C100"),
    encode("pay\u00AD100"),
  ]) {
    assert.equal(messageContent(hex).readable, false);
    assert.equal(messageContent(hex).text, hex);
  }
});
