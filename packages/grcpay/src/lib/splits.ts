import { grc2halford } from './nomination';

// Most splits a wallet may carry. Each split is one more output of the
// payout tx (~34 bytes) while the payout still reserves a flat MIN_FEE,
// and every split costs a validateaddress call on the public
// POST /wallets, so the list stays short.
export const MAX_SPLITS = 10;

// A split as the API takes it: amount in GRC.
export interface SplitInput {
  address: string;
  amount: number;
}

// A split as stored and paid: amount in halford.
export interface WalletSplit {
  address: string;
  halford: bigint;
}

// `wallets.splits` holds JSON `[{ address, amount }]`, amount a halford
// decimal string (JSON has no bigint). NULL means no splits.
export function parseSplits(json: string | null): WalletSplit[] {
  if (!json) return [];
  return (JSON.parse(json) as { address: string; amount: string }[])
    .map(({ address, amount }) => ({ address, halford: BigInt(amount) }));
}

export function serializeSplits(splits: WalletSplit[]): string | null {
  if (splits.length === 0) return null;
  return JSON.stringify(
    splits.map(({ address, halford }) => ({ address, amount: halford.toString() })),
  );
}

export function toWalletSplits(splits: SplitInput[] | undefined): WalletSplit[] {
  // Number(): Joi accepts a numeric string (" 0.8 ") but the request
  // body reaches here unconverted, and Decimal rejects the padding.
  return (splits ?? []).map(({ address, amount }) => ({
    address,
    halford: grc2halford(Number(amount)),
  }));
}
