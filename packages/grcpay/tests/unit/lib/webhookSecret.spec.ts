let mockKey: string | undefined;

jest.mock('../../../src/config', () => ({
  config: {
    get WEBHOOK_SECRET_KEY() {
      return mockKey;
    },
  },
}));

// eslint-disable-next-line import/first
import { encryptWebhookSecret, decryptWebhookSecret } from '../../../src/lib/webhookSecret';

const SECRET = 'whsec_0123456789abcdef0123456789abcdef';

describe('webhookSecret at-rest encryption', () => {
  describe('with WEBHOOK_SECRET_KEY set', () => {
    beforeEach(() => { mockKey = 'a-strong-operator-passphrase'; });

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
    beforeEach(() => { mockKey = undefined; });

    it('stores and reads plaintext unchanged', () => {
      expect(encryptWebhookSecret(SECRET)).toBe(SECRET);
      expect(decryptWebhookSecret(SECRET)).toBe(SECRET);
    });

    it('throws if asked to decrypt an encrypted value without the key', () => {
      mockKey = 'k';
      const stored = encryptWebhookSecret(SECRET);
      mockKey = undefined;
      expect(() => decryptWebhookSecret(stored)).toThrow(/WEBHOOK_SECRET_KEY/);
    });
  });
});
