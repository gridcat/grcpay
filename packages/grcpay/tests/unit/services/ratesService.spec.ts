import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Import after mock is set up
import { RatesService, UnsupportedCurrencyError } from '../../../src/services/rates/ratesService';

// Clear private caches and health counters via any-cast.
function resetService(): void {
  (RatesService as any).rateCache = new Map();
  (RatesService as any).currenciesCache = null;
  (RatesService as any).inFlightRates = new Map();
  (RatesService as any).inFlightCurrencies = null;
  (RatesService as any).lastSuccessAt = null;
  (RatesService as any).lastFailureAt = null;
  (RatesService as any).lastError = null;
  (RatesService as any).consecutiveFailures = 0;
  (RatesService as any).degraded = false;
}

describe('RatesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetService();
  });

  describe('getRate', () => {
    it('fetches rate from CoinGecko and returns it', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: ['eur', 'usd', 'gbp'] })
        .mockResolvedValueOnce({ data: { 'gridcoin-research': { eur: 0.0034 } } });

      const rate = await RatesService.getRate('eur');

      expect(rate).toBe(0.0034);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('returns cached rate on second call', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: ['eur', 'usd'] })
        .mockResolvedValueOnce({ data: { 'gridcoin-research': { eur: 0.005 } } });

      const rate1 = await RatesService.getRate('eur');
      const rate2 = await RatesService.getRate('eur');

      expect(rate1).toBe(0.005);
      expect(rate2).toBe(0.005);
      // currencies + rate = 2 calls, second getRate uses cache
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('throws for unsupported currency', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: ['eur', 'usd'] });

      await expect(RatesService.getRate('xyz')).rejects.toThrow('not supported');
    });

    it('throws when CoinGecko returns no rate', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: ['eur'] })
        .mockResolvedValueOnce({ data: { 'gridcoin-research': {} } });

      await expect(RatesService.getRate('eur')).rejects.toThrow('Unable to fetch rate');
    });

    it('throws when CoinGecko request fails', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: ['eur'] })
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(RatesService.getRate('eur')).rejects.toThrow('Network error');
    });

    it('normalizes currency to lowercase', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: ['eur'] })
        .mockResolvedValueOnce({ data: { 'gridcoin-research': { eur: 0.003 } } });

      const rate = await RatesService.getRate('EUR');
      expect(rate).toBe(0.003);
    });
  });

  describe('getSupportedCurrencies', () => {
    it('fetches and returns currencies', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: ['eur', 'usd', 'gbp'] });

      const currencies = await RatesService.getSupportedCurrencies();
      expect(currencies).toEqual(['eur', 'usd', 'gbp']);
    });

    it('caches currencies on second call', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: ['eur', 'usd'] });

      await RatesService.getSupportedCurrencies();
      await RatesService.getSupportedCurrencies();

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('throws on invalid response', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: 'not an array' });

      await expect(RatesService.getSupportedCurrencies()).rejects.toThrow('Invalid response');
    });
  });
});

// Routes mocked axios by URL so concurrent tests don't depend on call order.
function mockCoinGecko(opts: {
  currencies?: string[] | Error;
  price?: Record<string, number> | Error;
}) {
  mockedAxios.get.mockReset();
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.includes('supported_vs_currencies')) {
      if (opts.currencies instanceof Error) throw opts.currencies;
      return { data: opts.currencies ?? ['usd', 'eur', 'gbp'] };
    }
    if (opts.price instanceof Error) throw opts.price;
    const vs = new URL(url).searchParams.get('vs_currencies') as string;
    return { data: { 'gridcoin-research': { [vs]: (opts.price ?? {})[vs] } } };
  });
}

function axiosError(status: number): Error {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean; response: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

function priceCalls(): number {
  return mockedAxios.get.mock.calls.filter(([u]) => String(u).includes('simple/price')).length;
}

function currencyCalls(): number {
  return mockedAxios.get.mock.calls.filter(([u]) => String(u).includes('supported_vs')).length;
}

/** Age the cached quote for `key` so the next getRate has to go upstream. */
function expireRateCache(key: string, ageMs: number): void {
  const entry = (RatesService as any).rateCache.get(key);
  entry.fetchedAt = Date.now() - ageMs;
}

describe('RatesService upstream resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetService();
    (mockedAxios.isAxiosError as any).mockImplementation(
      (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError,
    );
  });

  it('collapses concurrent calls for one currency into a single upstream fetch', async () => {
    mockCoinGecko({ price: { eur: 0.0034 } });

    const rates = await Promise.all([
      RatesService.getRate('eur'),
      RatesService.getRate('eur'),
      RatesService.getRate('eur'),
    ]);

    expect(rates).toEqual([0.0034, 0.0034, 0.0034]);
    expect(priceCalls()).toBe(1);
    expect(currencyCalls()).toBe(1);
  });

  it('fetches the currency list once for a parallel multi-currency burst', async () => {
    // This is grcbazaar's access pattern; on a cold cache it used to be
    // 6 CoinGecko calls at once, which is what drew the 429.
    mockCoinGecko({ price: { usd: 0.0063, eur: 0.0054, gbp: 0.0046 } });

    const rates = await Promise.all([
      RatesService.getRate('usd'),
      RatesService.getRate('eur'),
      RatesService.getRate('gbp'),
    ]);

    expect(rates).toEqual([0.0063, 0.0054, 0.0046]);
    expect(currencyCalls()).toBe(1);
    expect(priceCalls()).toBe(3);
  });

  it('serves the last known rate when the refresh is rate-limited', async () => {
    mockCoinGecko({ price: { eur: 0.005 } });
    expect(await RatesService.getRate('eur')).toBe(0.005);

    expireRateCache('eur', 10 * 60 * 1000);
    mockCoinGecko({ price: axiosError(429) });

    expect(await RatesService.getRate('eur')).toBe(0.005);
    expect(RatesService.getHealth()).toMatchObject({
      ok: true,
      degraded: true,
      lastError: 'rate provider returned HTTP 429',
      consecutiveFailures: 0,
    });
  });

  it('gives up once the cached rate is older than the stale window', async () => {
    mockCoinGecko({ price: { eur: 0.005 } });
    await RatesService.getRate('eur');

    expireRateCache('eur', 7 * 60 * 60 * 1000);
    mockCoinGecko({ price: axiosError(429) });

    await expect(RatesService.getRate('eur')).rejects.toThrow('429');
    expect(RatesService.getHealth()).toMatchObject({ ok: false, consecutiveFailures: 1 });
  });

  it('recovers health once upstream answers again', async () => {
    mockCoinGecko({ price: axiosError(503) });
    await expect(RatesService.getRate('eur')).rejects.toThrow();
    expect(RatesService.getHealth().ok).toBe(false);

    mockCoinGecko({ price: { eur: 0.006 } });
    expect(await RatesService.getRate('eur')).toBe(0.006);
    expect(RatesService.getHealth()).toMatchObject({ ok: true, degraded: false });
  });

  it('does not count an unsupported currency as an upstream failure', async () => {
    mockCoinGecko({ currencies: ['eur', 'usd'] });

    await expect(RatesService.getRate('xyz')).rejects.toBeInstanceOf(UnsupportedCurrencyError);
    expect(RatesService.getHealth()).toMatchObject({
      ok: true,
      degraded: false,
      lastError: null,
    });
  });

  it('keeps serving the cached currency list when that call fails', async () => {
    mockCoinGecko({ price: { eur: 0.005 } });
    await RatesService.getSupportedCurrencies();

    (RatesService as any).currenciesCache.fetchedAt = Date.now() - 25 * 60 * 60 * 1000;
    mockCoinGecko({ currencies: axiosError(429), price: { eur: 0.005 } });

    expect(await RatesService.getSupportedCurrencies()).toEqual(['usd', 'eur', 'gbp']);
  });
});
