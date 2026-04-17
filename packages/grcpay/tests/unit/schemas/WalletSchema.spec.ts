import { WalletSchema } from '../../../src/controllers/schemas/WalletSchema';

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
