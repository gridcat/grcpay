import Decimal from 'decimal.js';
import { config } from '../config';

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
