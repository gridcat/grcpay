import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { config } from '../config';

// At-rest protection for the webhook signing secret. The secret has to
// be stored intact (it's the HMAC key we sign every delivery with), but
// grc-control volume-mounts payment.db read-only, so a plaintext column
// hands that sibling — and anything that can read the DB file (backups,
// an ops dashboard) — the ability to forge validly-signed webhooks.
//
// AES-256-GCM with a key derived from WEBHOOK_SECRET_KEY. Encryption is
// OPT-IN: with no key set, values are stored/read verbatim so existing
// deployments (and the webhooks-off public sandbox) are unaffected.
// Turning it on is just setting the env var — legacy plaintext rows are
// still readable (the prefix tells them apart), and new rows encrypt.
const PREFIX = 'enc:v1:';

function derivedKey(): Buffer | null {
  const raw = config.WEBHOOK_SECRET_KEY;
  if (!raw) return null;
  // SHA-256 of the configured string → a stable 32-byte AES-256 key,
  // so operators can use any-length passphrase.
  return createHash('sha256').update(raw).digest();
}

/** Encrypt for storage. Returns the value unchanged when no key is set. */
export function encryptWebhookSecret(plain: string): string {
  const key = derivedKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ciphertext].map((b) => b.toString('base64')).join(':');
}

/** Decrypt a stored value. Passes legacy plaintext rows through unchanged. */
export function decryptWebhookSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = derivedKey();
  if (!key) {
    throw new Error(
      'Encrypted webhook secret found but WEBHOOK_SECRET_KEY is not set — '
      + 'cannot sign deliveries. Restore the key that encrypted this row.',
    );
  }
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
