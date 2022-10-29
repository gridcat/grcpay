import Decimal from 'decimal.js';
import { config } from '../config';

/**
 * GRC to Halford
 *
 * @export
 * @param {number} amount
 * @returns {BigInt}
 */
export function grc2halford(amount: number): BigInt {
  const amountDecimal = new Decimal(amount);
  const halfordNoDecimal = new Decimal(config.HALFORD);
  // ceil to deal with JS
  const amountHalford = amountDecimal.mul(halfordNoDecimal).ceil();
  return BigInt(amountHalford.toString());
}

/**
 * Halford to GRC
 *
 * @export
 * @param {BigInt} amount
 * @returns {Decimal}
 */
export function halford2grc(amount: BigInt): Decimal {
  const amountDecimal = new Decimal(amount.toString());
  const halfordNoDecimal = new Decimal(config.HALFORD);
  return Decimal.div(amountDecimal, halfordNoDecimal);
}
