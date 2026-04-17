import { generateToken, hashToken, tokenMatches } from '../../../src/lib/walletToken';

describe('walletToken', () => {
  describe('generateToken', () => {
    it('produces a non-empty base64url string', () => {
      const t = generateToken();
      expect(t).toBeTruthy();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet
    });

    it('produces distinct tokens on each call', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(generateToken());
      }
      expect(seen.size).toBe(50);
    });
  });

  describe('hashToken', () => {
    it('produces a 64-char hex sha256', () => {
      const h = hashToken('hello');
      expect(h).toHaveLength(64);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same input', () => {
      expect(hashToken('same')).toBe(hashToken('same'));
    });

    it('produces different hashes for different inputs', () => {
      expect(hashToken('a')).not.toBe(hashToken('b'));
    });
  });

  describe('tokenMatches', () => {
    it('returns true for a token whose hash equals the stored hash', () => {
      const token = generateToken();
      const stored = hashToken(token);
      expect(tokenMatches(token, stored)).toBe(true);
    });

    it('returns false when the token is wrong', () => {
      const stored = hashToken('correct');
      expect(tokenMatches('wrong', stored)).toBe(false);
    });

    it('returns false when either side is empty', () => {
      expect(tokenMatches('', 'a')).toBe(false);
      expect(tokenMatches('a', '')).toBe(false);
    });

    it('returns false when lengths differ', () => {
      // Not a real hash — just a short string that can never be the
      // hex sha256 of anything.
      expect(tokenMatches('x', 'short')).toBe(false);
    });
  });
});
