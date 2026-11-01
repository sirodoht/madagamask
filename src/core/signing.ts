import { record, UserError } from "./validation.ts";

// Any added network can sign; these are the ones covered without a warning.
export const TESTED_CHAINS = new Set([1, 11155111, 84532, 31337, 1337]);

export function readTypedData(value: unknown) {
  const data = record(typeof value === "string" ? JSON.parse(value) : value);
  return {
    domain: record(data.domain),
    types: record(data.types),
    message: record(data.message),
    primaryType: String(data.primaryType),
  };
}

// Every displayed domain/message field must actually be covered by the signature.
export function validateSigningFields(value: unknown) {
  const { domain, types, message, primaryType } = readTypedData(value);
  const domainTypes: Record<string, string> = {
    name: "string",
    version: "string",
    chainId: "uint256",
    verifyingContract: "address",
    salt: "bytes32",
  };
  if (Object.keys(domain).some((key) => !Object.hasOwn(domainTypes, key)))
    throw new UserError("Unsupported signature domain field.");
  const expected = Object.keys(domain).map((name) => ({
    name,
    type: domainTypes[name],
  }));
  const declared = types.EIP712Domain ?? expected;
  if (
    !Array.isArray(declared) ||
    declared.length !== expected.length ||
    expected.some(
      (field) =>
        declared.filter(
          (entry) => entry?.name === field.name && entry?.type === field.type,
        ).length !== 1,
    )
  )
    throw new UserError(
      "Signature domain fields do not match the signed schema.",
    );
  if (primaryType === "EIP712Domain")
    throw new UserError("Domain-only signatures are not supported.");
  const check = (type: string, input: unknown, depth = 0): void => {
    if (depth > 30) throw new UserError("Typed data is nested too deeply.");
    const array = /^(.*)\[([0-9]*)\]$/.exec(type);
    if (array) {
      if (
        !Array.isArray(input) ||
        (array[2] && input.length !== Number(array[2]))
      )
        throw new UserError("Invalid typed-data array.");
      for (const item of input) check(array[1] as string, item, depth + 1);
    } else if (Object.hasOwn(types, type)) {
      const fields = types[type];
      const object = record(input);
      if (
        !Array.isArray(fields) ||
        fields.length !== Object.keys(object).length ||
        new Set(fields.map((field) => field.name)).size !== fields.length ||
        fields.some((field) => !Object.hasOwn(object, field.name))
      )
        throw new UserError("Message fields do not match the signed schema.");
      for (const field of fields)
        check(String(field.type), object[field.name], depth + 1);
    } else if (typeof input === "number" && !Number.isSafeInteger(input))
      throw new UserError(
        "Use a decimal string for large typed-data integers.",
      );
  };
  check(primaryType, message);
}

const permitFields = [
  ["owner", "address"],
  ["spender", "address"],
  ["value", "uint256"],
  ["nonce", "uint256"],
  ["deadline", "uint256"],
];
const singleFields = [
  ["details", "PermitDetails"],
  ["spender", "address"],
  ["sigDeadline", "uint256"],
];
const detailFields = [
  ["token", "address"],
  ["amount", "uint160"],
  ["expiration", "uint48"],
  ["nonce", "uint48"],
];
function matches(
  fields: unknown,
  expected: string[][],
  value: Record<string, unknown>,
) {
  return (
    Array.isArray(fields) &&
    fields.length === expected.length &&
    Object.keys(value).length === expected.length &&
    expected.every(([name, type], index) => {
      const field = fields[index];
      return (
        field?.name === name &&
        field?.type === type &&
        Object.hasOwn(value, name as string)
      );
    })
  );
}
function uint(value: unknown, bits = 256): string {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Inexact number");
  const raw = String(value);
  if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(raw))
    throw new Error("Invalid integer");
  const number = BigInt(raw);
  if (number >= 2n ** BigInt(bits)) throw new Error("Integer out of range");
  return number.toString();
}
function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error("Invalid address");
  return value;
}
export type SpendingPermission = {
  kind: "erc2612" | "permit2";
  token: string;
  spender: string;
  owner?: string;
  amount: string;
  unlimited: boolean;
  deadline: string;
  expiration?: string;
  nonce: string;
};

// Recognize exact published schemas, not field-name guesses. Matching a schema
// describes declared intent; it does not verify the contract or its behavior.
export function spendingPermission(
  value: unknown,
): SpendingPermission | undefined {
  try {
    const { domain, types, message, primaryType } = readTypedData(value);
    const contract = address(domain.verifyingContract);
    if (
      primaryType === "Permit" &&
      matches(types.Permit, permitFields, message)
    ) {
      const amount = uint(message.value);
      return {
        kind: "erc2612",
        token: contract,
        spender: address(message.spender),
        owner: address(message.owner),
        amount,
        unlimited: amount === (2n ** 256n - 1n).toString(),
        deadline: uint(message.deadline),
        nonce: uint(message.nonce),
      };
    }
    if (
      primaryType === "PermitSingle" &&
      matches(types.PermitSingle, singleFields, message)
    ) {
      const details = record(message.details);
      if (!matches(types.PermitDetails, detailFields, details)) return;
      const amount = uint(details.amount, 160);
      return {
        kind: "permit2",
        token: address(details.token),
        spender: address(message.spender),
        amount,
        unlimited: amount === (2n ** 160n - 1n).toString(),
        deadline: uint(message.sigDeadline),
        expiration: uint(details.expiration, 48),
        nonce: uint(details.nonce, 48),
      };
    }
  } catch {
    /* Unrecognized data is shown in full, never given a reassuring summary. */
  }
  return undefined;
}

export function reducePermission(value: unknown, amount: unknown) {
  const permission = spendingPermission(value);
  if (!permission)
    throw new UserError("This spending permission cannot be edited safely.");
  if (
    typeof amount !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(amount) ||
    amount.length > 78 ||
    BigInt(amount) > BigInt(permission.amount)
  )
    throw new UserError(
      "Enter a whole number of base units no greater than the current allowance.",
    );
  const data = structuredClone(
    record(typeof value === "string" ? JSON.parse(value) : value),
  );
  const message = record(data.message);
  if (permission.kind === "erc2612") message.value = amount;
  else record(message.details).amount = amount;
  return typeof value === "string" ? JSON.stringify(data) : data;
}

export function messageContent(value: unknown) {
  const hex = String(value);
  try {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error();
    const bytes = Uint8Array.from(hex.slice(2).match(/.{2}/g) ?? [], (byte) =>
      Number.parseInt(byte, 16),
    );
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    // Hidden formatting/control characters can make the displayed message misleading.
    if (
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Identify invisible/control bytes in signing messages.
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u.test(text)
    )
      throw new Error();
    return { readable: true, text: text || "(Empty message)", hex };
  } catch {
    return { readable: false, text: hex, hex };
  }
}

export function signatureDeadline(value: string, now = Date.now()) {
  const seconds = BigInt(value);
  if (seconds > 8_640_000_000_000n) return `No practical deadline (${value})`;
  const date = new Date(Number(seconds) * 1000).toISOString();
  return `${date} (${value})${seconds * 1000n < BigInt(now) ? " · expired" : ""}`;
}
