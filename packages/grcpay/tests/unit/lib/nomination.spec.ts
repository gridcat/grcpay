import { grc2halford, halford2grc } from '../../../src/lib/nomination';
import Decimal from 'decimal.js';

describe('nomination', () => {
  describe('grc2halford', () => {
    it('converts whole GRC to halford', () => {
      expect(grc2halford(1)).toEqual(BigInt(100000000));
    });

    it('converts fractional GRC to halford', () => {
      expect(grc2halford(0.5)).toEqual(BigInt(50000000));
    });

    it('converts zero', () => {
      expect(grc2halford(0)).toEqual(BigInt(0));
    });

    it('converts small amounts', () => {
      expect(grc2halford(0.001)).toEqual(BigInt(100000));
    });

    it('converts large amounts', () => {
      expect(grc2halford(1000)).toEqual(BigInt(100000000000));
    });

    it('ceils to avoid floating point issues', () => {
      // 0.1 + 0.2 style issues should be handled by Decimal.js ceil
      const result = grc2halford(0.00000001);
      expect(result).toEqual(BigInt(1));
    });
  });

  describe('halford2grc', () => {
    it('converts halford to GRC', () => {
      const result = halford2grc(BigInt(100000000));
      expect(result.equals(new Decimal(1))).toBe(true);
    });

    it('converts fractional halford', () => {
      const result = halford2grc(BigInt(50000000));
      expect(result.equals(new Decimal(0.5))).toBe(true);
    });

    it('converts zero', () => {
      const result = halford2grc(BigInt(0));
      expect(result.equals(new Decimal(0))).toBe(true);
    });

    it('converts small amounts', () => {
      const result = halford2grc(BigInt(1));
      expect(result.equals(new Decimal('0.00000001'))).toBe(true);
    });
  });
});
