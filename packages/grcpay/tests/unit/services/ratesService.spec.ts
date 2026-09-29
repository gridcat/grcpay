import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

const mockState = vi.hoisted((): { apiKey: string | undefined } => ({ apiKey: undefined }));

vi.mock('../../../src/config', () => ({
  config: {
    get COINGECKO_API_KEY() {
      return mockState.apiKey;
    },
  },
}));

// Import after mock is set up
import { RatesService, UnsupportedCurrencyError } from '../../../src/services/rates/ratesService';

// Clear the private cache and health counters via any-cast.
function resetService(): void {
  (RatesService as any).quote = null;
  (RatesService as any).inFlight = null;
  (RatesService as any).lastSuccessAt = null;
  (RatesService as any).lastFailureAt = null;
  (RatesService as any).lastError = null;
  (RatesService as any).consecutiveFailures = 0;
  (RatesService as any).degraded = false;
  mockState.apiKey = undefined;
}

/** The slice of CoinGecko's /coins/{id} answer the service reads. */
function coinResponse(prices: Record<string, unknown>) {
  return { data: { market_data: { current_price: prices } } };
}

describe('RatesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetService();
  });

  describe('getRate', () => {
    it('fetches the quote from CoinGecko and returns the rate', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.0034, usd: 0.0039 }));

      const rate = await RatesService.getRate('eur');

      expect(rate).toBe(0.0034);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(String(mockedAxios.get.mock.calls[0][0])).toContain('/coins/gridcoin-research');
    });

    it('returns cached rate on second call', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005 }));

      const rate1 = await RatesService.getRate('eur');
      const rate2 = await RatesService.getRate('eur');

      expect(rate1).toBe(0.005);
      expect(rate2).toBe(0.005);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('serves every currency from the one quote', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ usd: 0.0063, eur: 0.0054, gbp: 0.0046 }));

      expect(await RatesService.getRate('usd')).toBe(0.0063);
      expect(await RatesService.getRate('eur')).toBe(0.0054);
      expect(await RatesService.getRate('gbp')).toBe(0.0046);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('throws for unsupported currency', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005, usd: 0.006 }));

      await expect(RatesService.getRate('xyz')).rejects.toThrow('not supported');
    });

    it('throws when CoinGecko returns no prices', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { market_data: {} } });

      await expect(RatesService.getRate('eur')).rejects.toThrow('Invalid response');
    });

    it('drops prices that are not positive numbers', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005, usd: null, gbp: 0 }));

      expect(await RatesService.getRate('eur')).toBe(0.005);
      await expect(RatesService.getRate('usd')).rejects.toBeInstanceOf(UnsupportedCurrencyError);
      await expect(RatesService.getRate('gbp')).rejects.toBeInstanceOf(UnsupportedCurrencyError);
    });

    it('throws when CoinGecko request fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(RatesService.getRate('eur')).rejects.toThrow('Network error');
    });

    it('normalizes currency to lowercase', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.003 }));

      const rate = await RatesService.getRate('EUR');
      expect(rate).toBe(0.003);
    });

    it('sends no key header while COINGECKO_API_KEY is unset', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005 }));

      await RatesService.getRate('eur');

      expect(mockedAxios.get.mock.calls[0][1]?.headers).toEqual({});
    });

    it('sends the Demo key header when COINGECKO_API_KEY is set', async () => {
      mockState.apiKey = 'cg-demo-test';
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005 }));

      await RatesService.getRate('eur');

      expect(mockedAxios.get.mock.calls[0][1]?.headers).toEqual({ 'x-cg-demo-api-key': 'cg-demo-test' });
    });
  });

  describe('getSupportedCurrencies', () => {
    it('lists the currencies the quote carries', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005, usd: 0.006, gbp: 0.004 }));

      const currencies = await RatesService.getSupportedCurrencies();
      expect(currencies).toEqual(['eur', 'usd', 'gbp']);
    });

    it('caches currencies on second call', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005, usd: 0.006 }));

      await RatesService.getSupportedCurrencies();
      await RatesService.getSupportedCurrencies();

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('shares the quote with getRate', async () => {
      mockedAxios.get.mockResolvedValueOnce(coinResponse({ eur: 0.005, usd: 0.006 }));

      await RatesService.getRate('eur');
      expect(await RatesService.getSupportedCurrencies()).toEqual(['eur', 'usd']);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('throws on invalid response', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: 'not an object' });

      await expect(RatesService.getSupportedCurrencies()).rejects.toThrow('Invalid response');
    });
  });
});

// Routes mocked axios through one implementation so concurrent tests don't
// depend on call order.
function mockCoinGecko(prices: Record<string, number> | Error) {
  mockedAxios.get.mockReset();
  mockedAxios.get.mockImplementation(async () => {
    if (prices instanceof Error) throw prices;
    return coinResponse(prices);
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

/** Age the cached quote so the next lookup has to go upstream. */
function expireQuote(ageMs: number): void {
  (RatesService as any).quote.fetchedAt = Date.now() - ageMs;
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
    mockCoinGecko({ eur: 0.0034 });

    const rates = await Promise.all([
      RatesService.getRate('eur'),
      RatesService.getRate('eur'),
      RatesService.getRate('eur'),
    ]);

    expect(rates).toEqual([0.0034, 0.0034, 0.0034]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('answers a parallel multi-currency burst with one upstream call', async () => {
    // This is grcbazaar's access pattern; on a cold cache it used to be
    // 6 CoinGecko calls at once, which is what drew the 429.
    mockCoinGecko({ usd: 0.0063, eur: 0.0054, gbp: 0.0046 });

    const rates = await Promise.all([
      RatesService.getRate('usd'),
      RatesService.getRate('eur'),
      RatesService.getRate('gbp'),
      RatesService.getSupportedCurrencies(),
    ]);

    expect(rates).toEqual([0.0063, 0.0054, 0.0046, ['usd', 'eur', 'gbp']]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('serves the last known rate when the refresh is rate-limited', async () => {
    mockCoinGecko({ eur: 0.005 });
    expect(await RatesService.getRate('eur')).toBe(0.005);

    expireQuote(10 * 60 * 1000);
    mockCoinGecko(axiosError(429));

    expect(await RatesService.getRate('eur')).toBe(0.005);
    expect(RatesService.getHealth()).toMatchObject({
      ok: true,
      degraded: true,
      lastError: 'rate provider returned HTTP 429',
      consecutiveFailures: 0,
    });
  });

  it('gives up once the cached rate is older than the stale window', async () => {
    mockCoinGecko({ eur: 0.005 });
    await RatesService.getRate('eur');

    expireQuote(7 * 60 * 60 * 1000);
    mockCoinGecko(axiosError(429));

    await expect(RatesService.getRate('eur')).rejects.toThrow('429');
    expect(RatesService.getHealth()).toMatchObject({ ok: false, consecutiveFailures: 1 });
  });

  it('counts one failure for a burst that shares the failed refresh', async () => {
    mockCoinGecko(axiosError(503));

    const results = await Promise.allSettled([
      RatesService.getRate('usd'),
      RatesService.getRate('eur'),
      RatesService.getRate('gbp'),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(RatesService.getHealth()).toMatchObject({ ok: false, consecutiveFailures: 1 });
  });

  it('recovers health once upstream answers again', async () => {
    mockCoinGecko(axiosError(503));
    await expect(RatesService.getRate('eur')).rejects.toThrow();
    expect(RatesService.getHealth().ok).toBe(false);

    mockCoinGecko({ eur: 0.006 });
    expect(await RatesService.getRate('eur')).toBe(0.006);
    expect(RatesService.getHealth()).toMatchObject({ ok: true, degraded: false });
  });

  it('does not count an unsupported currency as an upstream failure', async () => {
    mockCoinGecko({ eur: 0.005, usd: 0.006 });

    await expect(RatesService.getRate('xyz')).rejects.toBeInstanceOf(UnsupportedCurrencyError);
    expect(RatesService.getHealth()).toMatchObject({
      ok: true,
      degraded: false,
      lastError: null,
    });
  });

  it('keeps serving the currency list long after the rates went stale', async () => {
    mockCoinGecko({ usd: 0.006, eur: 0.005, gbp: 0.004 });
    await RatesService.getSupportedCurrencies();

    expireQuote(25 * 60 * 60 * 1000);
    mockCoinGecko(axiosError(429));

    expect(await RatesService.getSupportedCurrencies()).toEqual(['usd', 'eur', 'gbp']);
    await expect(RatesService.getRate('eur')).rejects.toThrow('429');
  });
});
