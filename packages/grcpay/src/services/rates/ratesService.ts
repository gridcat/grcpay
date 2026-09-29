/* eslint-disable max-classes-per-file */
import axios from 'axios';
import { config } from '../../config';
import { log } from '../../lib/log';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const GRC_ID = 'gridcoin-research';
// The coin endpoint carries GRC's price in every currency CoinGecko
// quotes, so one call covers rates and the currency list. The old
// per-currency /simple/price endpoint answers 403 to keyless callers.
const QUOTE_URL = `${COINGECKO_BASE}/coins/${GRC_ID}`
  + '?localization=false&tickers=false&market_data=true'
  + '&community_data=false&developer_data=false&sparkline=false';
const RATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// How long an expired quote stays servable once CoinGecko starts
// failing. Rates here are display only, so a few-hours-old number beats
// handing the caller nothing.
const RATE_STALE_MS = 6 * 60 * 60 * 1000;
// Same idea for the currency list, which changes about never.
const CURRENCIES_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** The caller asked for a currency CoinGecko doesn't quote. Their fault, not ours. */
export class UnsupportedCurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedCurrencyError';
  }
}

interface CachedQuote {
  /** Price of 1 GRC per currency code (lowercase), as CoinGecko quotes it. */
  prices: Record<string, number>;
  fetchedAt: number;
}

export interface RatesHealth {
  /** False once a lookup has failed outright with no cached quote to fall back on. */
  ok: boolean;
  /** True while the most recent upstream attempt failed, covered by cache or not. */
  degraded: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Sanitised reason: /status is public, so no URLs or upstream dumps. */
  lastError: string | null;
  consecutiveFailures: number;
}

/** Short, leak-free description of an upstream failure for the public /status. */
function describeUpstreamError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (e.response) return `rate provider returned HTTP ${e.response.status}`;
    if (e.code === 'ECONNABORTED') return 'rate provider timed out';
    return 'rate provider unreachable';
  }
  return 'rate provider returned an unusable response';
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

class RatesServiceClass {
  private quote: CachedQuote | null = null;

  // Single-flight guard. A burst of concurrent callers (grcbazaar asks
  // for USD/EUR/GBP in parallel) shares one CoinGecko call. A fan-out
  // is exactly what earns a 429 on the free tier.
  private inFlight: Promise<CachedQuote> | null = null;

  private lastSuccessAt: number | null = null;

  private lastFailureAt: number | null = null;

  private lastError: string | null = null;

  private consecutiveFailures = 0;

  // Explicit flag rather than comparing the two timestamps: success and
  // failure can land in the same millisecond.
  private degraded = false;

  /**
   * Get GRC exchange rate for a fiat currency.
   * Returns the price of 1 GRC in the given currency.
   */
  public async getRate(currency: string): Promise<number> {
    const key = currency.toLowerCase();
    const { prices } = await this.getQuote(RATE_STALE_MS);
    const rate = prices[key];
    if (rate === undefined) {
      throw new UnsupportedCurrencyError(`Currency "${key}" is not supported`);
    }
    return rate;
  }

  /**
   * Get list of currencies CoinGecko quotes GRC in.
   */
  public async getSupportedCurrencies(): Promise<string[]> {
    const { prices } = await this.getQuote(CURRENCIES_STALE_MS);
    return Object.keys(prices);
  }

  /** Upstream health, surfaced on /status so the control panel can shout about it. */
  public getHealth(): RatesHealth {
    return {
      ok: this.consecutiveFailures === 0,
      degraded: this.degraded,
      lastSuccessAt: iso(this.lastSuccessAt),
      lastFailureAt: iso(this.lastFailureAt),
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * The cached quote while it is fresh, otherwise one shared refresh. When
   * the refresh fails the stale quote is served while it is younger than
   * `staleMs`; past that the error propagates.
   */
  private async getQuote(staleMs: number): Promise<CachedQuote> {
    const cached = this.quote;
    if (cached && Date.now() - cached.fetchedAt < RATE_TTL_MS) {
      return cached;
    }

    if (!this.inFlight) {
      this.inFlight = this.refreshQuote().finally(() => { this.inFlight = null; });
    }

    try {
      return await this.inFlight;
    } catch (e: unknown) {
      if (cached && Date.now() - cached.fetchedAt < staleMs) {
        const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60000);
        log.warn(`Serving ${ageMin}m-stale GRC quote after upstream failure: ${e}`);
        return cached;
      }
      throw e;
    }
  }

  private async refreshQuote(): Promise<CachedQuote> {
    try {
      log.info('Fetching GRC quote from CoinGecko');
      const response = await axios.get(QUOTE_URL, {
        timeout: 10000,
        headers: config.COINGECKO_API_KEY
          ? { 'x-cg-demo-api-key': config.COINGECKO_API_KEY }
          : {},
      });

      const raw: unknown = response.data?.market_data?.current_price;
      if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid response from CoinGecko coin endpoint');
      }
      const prices: Record<string, number> = {};
      Object.entries(raw as Record<string, unknown>).forEach(([code, price]) => {
        if (typeof price === 'number' && price > 0) prices[code] = price;
      });
      if (Object.keys(prices).length === 0) {
        throw new Error('CoinGecko returned no GRC prices');
      }

      this.quote = { prices, fetchedAt: Date.now() };
      this.lastSuccessAt = Date.now();
      this.consecutiveFailures = 0;
      this.degraded = false;
      return this.quote;
    } catch (e: unknown) {
      this.lastFailureAt = Date.now();
      this.lastError = describeUpstreamError(e);
      this.degraded = true;
      // A failure the stale quote still covers is degradation, not an outage.
      const cached = this.quote;
      if (!cached || Date.now() - cached.fetchedAt >= RATE_STALE_MS) {
        this.consecutiveFailures += 1;
      }
      throw e;
    }
  }
}

export const RatesService = new RatesServiceClass();
