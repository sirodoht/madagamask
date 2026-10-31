export const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const spender = "0x0000000000000000000000000000000000005678";
export const token = "0x0000000000000000000000000000000000001234";
export const permit = {
  domain: {
    name: "Sample token",
    version: "1",
    chainId: 11155111,
    verifyingContract: token,
  },
  types: {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  message: {
    owner,
    spender,
    value: (2n ** 256n - 1n).toString(),
    nonce: "3",
    deadline: "2000000000",
  },
} as const;
export const permit2 = {
  domain: {
    name: "Permit2",
    chainId: 11155111,
    verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
  types: {
    PermitSingle: [
      { name: "details", type: "PermitDetails" },
      { name: "spender", type: "address" },
      { name: "sigDeadline", type: "uint256" },
    ],
    PermitDetails: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  primaryType: "PermitSingle",
  message: {
    details: {
      token,
      amount: (2n ** 160n - 1n).toString(),
      expiration: "1900000000",
      nonce: "5",
    },
    spender,
    sigDeadline: "1800000000",
  },
} as const;
