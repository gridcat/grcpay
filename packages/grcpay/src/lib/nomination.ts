import Decimal from 'decimal.js';
import { config } from '../config';

/**
 * MIN_FEE expressed in halford. Cached at module load so the
 * funded/expired/late-payment processors don't each recompute the
 * same value, and so refund-amount math stays in BigInt without
 * round-tripping through floating point.
 */
export const MIN_FEE_HALFORD = BigInt(Math.round(config.MIN_FEE * config.HALFORD));

/**
 * SPLIT_DUST in halford: a split below this is folded into the
 * primary recipient's output at payout. grcbazaar mirrors the default
 * as DONATION_DUST_HALFORD (its lib/donations) and never asks for a
 * split under it; raising this above 0.1 GRC would send such a split
 * to the seller without the bazaar knowing.
 */
export const SPLIT_DUST_HALFORD = BigInt(
  Math.round(config.SPLIT_DUST * config.HALFORD),
);

/**
 * GRC to Halford. Ceils to absorb decimal.js → bigint float residuals.
 */
export function grc2halford(amount: number): bigint {
  const amountDecimal = new Decimal(amount);
  const halfordNoDecimal = new Decimal(config.HALFORD);
  const amountHalford = amountDecimal.mul(halfordNoDecimal).ceil();
  return BigInt(amountHalford.toString());
}

/**
 * Halford to GRC.
 */
export function halford2grc(amount: bigint): Decimal {
  const amountDecimal = new Decimal(amount.toString());
  const halfordNoDecimal = new Decimal(config.HALFORD);
  return Decimal.div(amountDecimal, halfordNoDecimal);
}
