import { randomBytes, createHash, timingSafeEqual } from 'crypto';

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Constant-time comparison of a provided raw token against a stored
// hex sha256. Both sides come from createHash().digest('hex') so
// they're the same length and plain ASCII; timingSafeEqual avoids
// leaking a timing signal on mismatch.
export function tokenMatches(provided: string, expectedHash: string): boolean {
  if (!provided || !expectedHash) return false;
  const providedHash = hashToken(provided);
  if (providedHash.length !== expectedHash.length) return false;
  const a = Buffer.from(providedHash);
  const b = Buffer.from(expectedHash);
  return timingSafeEqual(a, b);
}
