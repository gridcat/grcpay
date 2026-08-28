import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted((): { key: string | undefined } => ({ key: undefined }));

vi.mock('../../../src/config', () => ({
  config: {
    get WEBHOOK_SECRET_KEY() {
      return mockState.key;
    },
  },
}));

// eslint-disable-next-line import/first
import { encryptWebhookSecret, decryptWebhookSecret } from '../../../src/lib/webhookSecret';

const SECRET = 'whsec_0123456789abcdef0123456789abcdef';

describe('webhookSecret at-rest encryption', () => {
  describe('with WEBHOOK_SECRET_KEY set', () => {
    beforeEach(() => { mockState.key = 'a-strong-operator-passphrase'; });

    it('round-trips a secret', () => {
      const stored = encryptWebhookSecret(SECRET);
      expect(stored).not.toBe(SECRET);
      expect(stored.startsWith('enc:v1:')).toBe(true);
      expect(decryptWebhookSecret(stored)).toBe(SECRET);
    });

    it('produces a fresh IV each time (ciphertext differs)', () => {
      expect(encryptWebhookSecret(SECRET)).not.toBe(encryptWebhookSecret(SECRET));
    });

    it('still reads legacy plaintext rows (no prefix)', () => {
      expect(decryptWebhookSecret(SECRET)).toBe(SECRET);
    });

    it('rejects a tampered ciphertext (GCM auth)', () => {
      const stored = encryptWebhookSecret(SECRET);
      const tampered = `${stored.slice(0, -4)}AAAA`;
      expect(() => decryptWebhookSecret(tampered)).toThrow();
    });
  });

  describe('with no key configured', () => {
    beforeEach(() => { mockState.key = undefined; });

    it('stores and reads plaintext unchanged', () => {
      expect(encryptWebhookSecret(SECRET)).toBe(SECRET);
      expect(decryptWebhookSecret(SECRET)).toBe(SECRET);
    });

    it('throws if asked to decrypt an encrypted value without the key', () => {
      mockState.key = 'k';
      const stored = encryptWebhookSecret(SECRET);
      mockState.key = undefined;
      expect(() => decryptWebhookSecret(stored)).toThrow(/WEBHOOK_SECRET_KEY/);
    });
  });
});
