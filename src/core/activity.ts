import { decodeFunctionData, erc20Abi, formatEther, formatUnits } from "viem";
import { baseSepolia, mainnet, sepolia } from "viem/chains";
import type { Network } from "./networks.ts";
import type { Token } from "./tokens.ts";
import type { Activity } from "./transactions.ts";

const statuses = {
  submitting: ["Submitting", "pending"],
  pending: ["Pending", "pending"],
  confirmed: ["Confirmed", "success"],
  reverted: ["Failed", "error"],
  unknown: ["Status unknown", "pending"],
  replaced: ["Replaced", "muted"],
  unseen: ["Not found", "pending"],
} as const;

export function presentActivity(
  item: Activity,
  network?: Network,
  tokens: Token[] = [],
) {
  let title = item.data === "0x" ? "Send" : "Contract interaction";
  let amount = `${formatEther(BigInt(item.value))} ${network?.symbol ?? "native"}`;
  const nativeAmount = amount;
  let recipient = item.to;
  const token = tokens.find(
    (token) =>
      token.chainId === item.chainId &&
      token.address.toLowerCase() === item.to.toLowerCase(),
  );
  if (item.data !== "0x") {
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: item.data });
      if (
        decoded.functionName === "transfer" ||
        decoded.functionName === "transferFrom"
      ) {
        const quantity =
          decoded.functionName === "transfer"
            ? decoded.args[1]
            : decoded.args[2];
        recipient =
          decoded.functionName === "transfer"
            ? decoded.args[0]
            : decoded.args[1];
        title = "Token transfer";
        amount = token
          ? `${formatUnits(quantity, token.decimals)} ${token.symbol}`
          : `${quantity} token base units`;
      } else if (decoded.functionName === "approve") {
        title = "Token approval";
        amount = token?.symbol ?? "Token";
      }
    } catch {
      /* Unknown calldata remains a contract interaction. */
    }
    if (title !== "Contract interaction" && BigInt(item.value) > 0n)
      amount += ` + ${nativeAmount}`;
  }
  const [label, tone] = statuses[item.status] ?? statuses.unknown;
  const explorer = [mainnet, sepolia, baseSepolia].find(
    (chain) => chain.id === item.chainId,
  )?.blockExplorers.default.url;
  return {
    ...item,
    display: {
      title,
      amount,
      recipient,
      status:
        item.error && ["confirmed", "reverted", "pending"].includes(item.status)
          ? `${label} · stale`
          : label,
      tone: item.error ? "pending" : tone,
      note:
        item.error ??
        (item.status === "reverted"
          ? "Transaction reverted. Network fees may still apply."
          : ["unknown", "unseen", "submitting"].includes(item.status)
            ? "Check the transaction status before sending again."
            : ""),
      explorer: explorer ? `${explorer}/tx/${item.hash}` : "",
    },
  };
}
export type ActivityView = ReturnType<typeof presentActivity>;
