import { describe, expect, it } from 'vitest';
import { WalletSchema } from '../../../src/controllers/schemas/WalletSchema';
import { MAX_SPLITS } from '../../../src/lib/splits';

const RECIPIENT = 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz';
const SPLIT_A = 'SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6i';
const SPLIT_B = 'SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6j';

// n distinct, well-formed split addresses of `amount` GRC each.
function splitList(n: number, amount = 0.1) {
  return Array.from({ length: n }, (_, i) => ({
    address: `SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs${'abcdefghijkmnopqrstuvwxyz'[i]}${'abcdefghijkmnopqrstuvwxyz'[i]}`,
    amount,
  }));
}

describe('WalletSchema', () => {
  const validData = {
    type: 'wallets',
    amountRequired: 10,
  };

  describe('valid inputs', () => {
    it('accepts minimal valid input', () => {
      const { error } = WalletSchema.validate(validData);
      expect(error).toBeUndefined();
    });

    it('accepts input with valid base58 recipient', () => {
      const { error } = WalletSchema.validate({
        ...validData,
        recipient: 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz',
      });
      expect(error).toBeUndefined();
    });

    it('accepts input with optional id', () => {
      const { error } = WalletSchema.validate({ ...validData, id: 123 });
      expect(error).toBeUndefined();
    });

    it('accepts fractional amountRequired', () => {
      const { error } = WalletSchema.validate({ ...validData, amountRequired: 0.5 });
      expect(error).toBeUndefined();
    });

    it('accepts explicit mode=checkout', () => {
      const { error } = WalletSchema.validate({ ...validData, mode: 'checkout' });
      expect(error).toBeUndefined();
    });

    it('accepts a valid lifespanSeconds override', () => {
      const { error } = WalletSchema.validate({ ...validData, lifespanSeconds: 3600 });
      expect(error).toBeUndefined();
    });

    it('accepts splits alongside a recipient', () => {
      const { error } = WalletSchema.validate({
        ...validData,
        recipient: RECIPIENT,
        splits: [{ address: SPLIT_A, amount: 0.8 }, { address: SPLIT_B, amount: 1.2 }],
      });
      expect(error).toBeUndefined();
    });

    it('accepts splits that leave exactly 2x the fee for the recipient', () => {
      const { error } = WalletSchema.validate({
        ...validData,
        recipient: RECIPIENT,
        splits: [{ address: SPLIT_A, amount: 4.999 }, { address: SPLIT_B, amount: 4.999 }],
      });
      expect(error).toBeUndefined();
    });

    it('ignores splits under SPLIT_DUST in the 2x-fee rule', () => {
      // 10 x 0.0999 GRC is all dust: the recipient keeps the whole 1 GRC.
      const { error } = WalletSchema.validate({
        ...validData,
        amountRequired: 1,
        recipient: RECIPIENT,
        splits: splitList(MAX_SPLITS, 0.0999),
      });
      expect(error).toBeUndefined();
    });

    it('counts only the splits at or over SPLIT_DUST in the 2x-fee rule', () => {
      const { error } = WalletSchema.validate({
        ...validData,
        amountRequired: 1,
        recipient: RECIPIENT,
        splits: [{ address: SPLIT_A, amount: 0.998 }, { address: SPLIT_B, amount: 0.05 }],
      });
      expect(error).toBeUndefined();
    });

    it('accepts an empty splits list without a recipient', () => {
      const { error } = WalletSchema.validate({ ...validData, splits: [] });
      expect(error).toBeUndefined();
    });

    it('accepts MAX_SPLITS splits', () => {
      const { error } = WalletSchema.validate({
        ...validData,
        recipient: RECIPIENT,
        splits: splitList(MAX_SPLITS),
      });
      expect(error).toBeUndefined();
    });
  });

  describe('splits', () => {
    const withRecipient = { ...validData, recipient: RECIPIENT };

    it('rejects splits when there is no primary recipient to split with', () => {
      const { error } = WalletSchema.validate({
        ...validData,
        splits: [{ address: SPLIT_A, amount: 1 }],
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/recipient/);
    });

    it('rejects more than MAX_SPLITS splits', () => {
      const { error } = WalletSchema.validate({
        ...withRecipient,
        splits: splitList(MAX_SPLITS + 1),
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/splits/);
    });

    it('rejects splits that leave the recipient less than 2x the fee', () => {
      const { error } = WalletSchema.validate({
        ...withRecipient,
        splits: [{ address: SPLIT_A, amount: 5 }, { address: SPLIT_B, amount: 4.9981 }],
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/splits must leave/);
    });

    it('rejects paid splits over the limit even when dust splits ride along', () => {
      const { error } = WalletSchema.validate({
        ...withRecipient,
        amountRequired: 1,
        splits: [{ address: SPLIT_A, amount: 0.9981 }, { address: SPLIT_B, amount: 0.05 }],
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/splits must leave/);
    });

    it('rejects a zero or negative split', () => {
      for (const amount of [0, -1]) {
        const { error } = WalletSchema.validate({
          ...withRecipient,
          splits: [{ address: SPLIT_A, amount }],
        });
        expect(error).toBeDefined();
      }
    });

    it('rejects a split without an amount', () => {
      const { error } = WalletSchema.validate({
        ...withRecipient,
        splits: [{ address: SPLIT_A }],
      });
      expect(error).toBeDefined();
    });

    it('rejects a split address equal to the recipient', () => {
      const { error } = WalletSchema.validate({
        ...withRecipient,
        splits: [{ address: RECIPIENT, amount: 1 }],
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/must differ from recipient/);
    });

    it('rejects the same split address twice', () => {
      const { error } = WalletSchema.validate({
        ...withRecipient,
        splits: [{ address: SPLIT_A, amount: 1 }, { address: SPLIT_A, amount: 2 }],
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/duplicate/);
    });

    it('rejects a malformed split address', () => {
      const { error } = WalletSchema.validate({
        ...withRecipient,
        splits: [{ address: 'not-an-address', amount: 1 }],
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/address/);
    });
  });

  describe('invalid inputs', () => {
    it('rejects missing amountRequired', () => {
      const { error } = WalletSchema.validate({ type: 'wallets' });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/amountRequired/);
    });

    it('rejects zero amountRequired', () => {
      const { error } = WalletSchema.validate({ ...validData, amountRequired: 0 });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/positive/);
    });

    it('rejects negative amountRequired', () => {
      const { error } = WalletSchema.validate({ ...validData, amountRequired: -5 });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/positive/);
    });

    it('rejects a sub-fee amountRequired that would strand funds', () => {
      // Below 2x MIN_FEE (0.001 GRC) — a wallet that can never forward a
      // positive amount to the merchant after the network fee.
      const { error } = WalletSchema.validate({ ...validData, amountRequired: 0.0005 });
      expect(error).toBeDefined();
    });

    it('rejects wrong type', () => {
      const { error } = WalletSchema.validate({ ...validData, type: 'other' });
      expect(error).toBeDefined();
    });

    it('rejects recipient with wrong length', () => {
      const { error } = WalletSchema.validate({ ...validData, recipient: 'tooshort' });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/length/);
    });

    it('rejects recipient with invalid characters', () => {
      // contains 0, O, I, l which are not valid base58
      const { error } = WalletSchema.validate({
        ...validData,
        recipient: '0OIl567890abcdef1234567890abcdef12',
      });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/base58/);
    });

    it('rejects wrong type value', () => {
      const { error } = WalletSchema.validate({ type: 'stamps', amountRequired: 10 });
      expect(error).toBeDefined();
    });

    it('rejects unknown mode (crowdfunding not implemented yet)', () => {
      const { error } = WalletSchema.validate({ ...validData, mode: 'crowdfunding' });
      expect(error).toBeDefined();
      expect(error!.message).toMatch(/mode/);
    });

    it('rejects lifespanSeconds below the minimum', () => {
      const { error } = WalletSchema.validate({ ...validData, lifespanSeconds: 30 });
      expect(error).toBeDefined();
    });

    it('rejects lifespanSeconds above 90 days', () => {
      const { error } = WalletSchema.validate({
        ...validData,
        lifespanSeconds: 60 * 60 * 24 * 91,
      });
      expect(error).toBeDefined();
    });

    it('rejects non-integer lifespanSeconds', () => {
      const { error } = WalletSchema.validate({ ...validData, lifespanSeconds: 60.5 });
      expect(error).toBeDefined();
    });
  });
});
