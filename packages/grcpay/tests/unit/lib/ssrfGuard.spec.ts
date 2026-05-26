// config is mocked so individual tests can flip WEBHOOK_ALLOW_PRIVATE.
jest.mock('../../../src/config', () => ({
  config: { WEBHOOK_ALLOW_PRIVATE: false },
}));
jest.mock('dns', () => ({ lookup: jest.fn() }));

import { lookup } from 'dns';
// eslint-disable-next-line import/first
import {
  isValidWebhookUrl,
  assertSafeWebhookUrl,
  WebhookUrlError,
  createPinnedLookup,
} from '../../../src/lib/ssrfGuard';
// eslint-disable-next-line import/first
import { config } from '../../../src/config';

const mockLookup = lookup as unknown as jest.Mock;

function resolvesTo(...addresses: { address: string; family: number }[]): void {
  mockLookup.mockImplementation((_host: string, _opts: unknown, cb: Function) => {
    cb(null, addresses);
  });
}

describe('ssrfGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config as { WEBHOOK_ALLOW_PRIVATE: boolean }).WEBHOOK_ALLOW_PRIVATE = false;
  });

  describe('isValidWebhookUrl (syntactic only, no DNS)', () => {
    it('accepts a well-formed https URL', () => {
      expect(isValidWebhookUrl('https://example.com/hook')).toBe(true);
    });

    it('rejects garbage', () => {
      expect(isValidWebhookUrl('not a url')).toBe(false);
      expect(isValidWebhookUrl('')).toBe(false);
      expect(isValidWebhookUrl('ftp://example.com')).toBe(false);
    });

    it('rejects embedded credentials', () => {
      expect(isValidWebhookUrl('https://user:pass@example.com/hook')).toBe(false);
    });

    it('rejects http unless WEBHOOK_ALLOW_PRIVATE is on', () => {
      expect(isValidWebhookUrl('http://example.com/hook')).toBe(false);
      (config as { WEBHOOK_ALLOW_PRIVATE: boolean }).WEBHOOK_ALLOW_PRIVATE = true;
      expect(isValidWebhookUrl('http://example.com/hook')).toBe(true);
    });

    it('does not resolve DNS', () => {
      isValidWebhookUrl('https://example.com/hook');
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe('assertSafeWebhookUrl (full guard, resolves + range-checks)', () => {
    it('accepts a public address and returns the pinned IP', async () => {
      resolvesTo({ address: '93.184.216.34', family: 4 });
      const r = await assertSafeWebhookUrl('https://example.com/hook');
      expect(r.pinnedIp).toBe('93.184.216.34');
      expect(r.family).toBe(4);
    });

    it.each([
      ['127.0.0.1', 4],
      ['10.1.2.3', 4],
      ['192.168.1.5', 4],
      ['169.254.1.1', 4],
      ['172.16.5.5', 4],
      ['100.64.0.1', 4],
      ['::1', 6],
      ['fe80::1', 6],
      ['fd00::1', 6],
      ['::ffff:10.0.0.1', 6],
    ])('rejects %s when private targets are not allowed', async (ip, family) => {
      resolvesTo({ address: ip, family });
      await expect(assertSafeWebhookUrl('https://internal.example/hook'))
        .rejects.toBeInstanceOf(WebhookUrlError);
    });

    it.each([
      ['0.0.0.0', 4],
      ['224.0.0.1', 4],
      ['255.255.255.255', 4],
      ['ff02::1', 6],
    ])('rejects %s even when WEBHOOK_ALLOW_PRIVATE is on', async (ip, family) => {
      (config as { WEBHOOK_ALLOW_PRIVATE: boolean }).WEBHOOK_ALLOW_PRIVATE = true;
      resolvesTo({ address: ip, family });
      await expect(assertSafeWebhookUrl('https://x.example/hook'))
        .rejects.toBeInstanceOf(WebhookUrlError);
    });

    it('allows a private address only when WEBHOOK_ALLOW_PRIVATE is on', async () => {
      resolvesTo({ address: '172.20.0.5', family: 4 });
      (config as { WEBHOOK_ALLOW_PRIVATE: boolean }).WEBHOOK_ALLOW_PRIVATE = true;
      const r = await assertSafeWebhookUrl('http://woocommerce.test/hook');
      expect(r.pinnedIp).toBe('172.20.0.5');
    });

    it('rejects the whole URL if ANY resolved address is private', async () => {
      resolvesTo(
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.9', family: 4 },
      );
      await expect(assertSafeWebhookUrl('https://multi.example/hook'))
        .rejects.toBeInstanceOf(WebhookUrlError);
    });

    it('rejects when DNS resolution fails', async () => {
      mockLookup.mockImplementation((_h: string, _o: unknown, cb: Function) => {
        cb(new Error('ENOTFOUND'));
      });
      await expect(assertSafeWebhookUrl('https://nope.example/hook'))
        .rejects.toBeInstanceOf(WebhookUrlError);
    });
  });

  describe('createPinnedLookup', () => {
    it('always yields the pinned IP (callback form)', (done) => {
      const pinned = createPinnedLookup('1.2.3.4', 4);
      pinned('whatever.host', {}, (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe('1.2.3.4');
        expect(family).toBe(4);
        done();
      });
    });

    it('supports the {all:true} form', (done) => {
      const pinned = createPinnedLookup('5.6.7.8', 4);
      pinned('whatever.host', { all: true }, (err: Error | null, addrs: unknown) => {
        expect(err).toBeNull();
        expect(addrs).toEqual([{ address: '5.6.7.8', family: 4 }]);
        done();
      });
    });
  });
});
