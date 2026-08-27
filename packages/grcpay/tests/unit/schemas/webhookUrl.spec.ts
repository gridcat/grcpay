import { beforeEach, describe, expect, it, vi } from 'vitest';

// Webhook-aware WalletSchema cases. Config is mocked so we can toggle
// the feature flag. MIN_FEE is included because the amountRequired rule
// floors at 2x MIN_FEE (evaluated when the schema is built).
vi.mock('../../../src/config', () => ({
  config: { WEBHOOKS_ENABLED: true, WEBHOOK_ALLOW_PRIVATE: false, MIN_FEE: 0.001 },
}));

// eslint-disable-next-line import/first
import { WalletSchema } from '../../../src/controllers/schemas/WalletSchema';
// eslint-disable-next-line import/first
import { config } from '../../../src/config';

const cfg = config as unknown as { WEBHOOKS_ENABLED: boolean; WEBHOOK_ALLOW_PRIVATE: boolean };

describe('WalletSchema webhookUrl', () => {
  const base = { type: 'wallets', amountRequired: 10 };

  beforeEach(() => {
    cfg.WEBHOOKS_ENABLED = true;
    cfg.WEBHOOK_ALLOW_PRIVATE = false;
  });

  it('accepts a syntactically valid https URL when the feature is on', () => {
    const { error } = WalletSchema.validate({ ...base, webhookUrl: 'https://shop.example/grcpay-hook' });
    expect(error).toBeUndefined();
  });

  it('still accepts a wallet with no webhookUrl (opt-in)', () => {
    const { error } = WalletSchema.validate(base);
    expect(error).toBeUndefined();
  });

  it('rejects a garbage webhookUrl', () => {
    const { error } = WalletSchema.validate({ ...base, webhookUrl: 'not-a-url' });
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/valid http/);
  });

  it('rejects http when WEBHOOK_ALLOW_PRIVATE is off', () => {
    const { error } = WalletSchema.validate({ ...base, webhookUrl: 'http://shop.example/hook' });
    expect(error).toBeDefined();
  });

  it('accepts http when WEBHOOK_ALLOW_PRIVATE is on', () => {
    cfg.WEBHOOK_ALLOW_PRIVATE = true;
    const { error } = WalletSchema.validate({ ...base, webhookUrl: 'http://woocommerce.test/hook' });
    expect(error).toBeUndefined();
  });

  it('rejects webhookUrl outright when the feature is disabled', () => {
    cfg.WEBHOOKS_ENABLED = false;
    const { error } = WalletSchema.validate({ ...base, webhookUrl: 'https://shop.example/hook' });
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/not enabled/);
  });
});
