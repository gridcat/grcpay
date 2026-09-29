/* eslint-disable max-classes-per-file */
import axios from 'axios';
import { log } from '../../lib/log';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const GRC_ID = 'gridcoin-research';
const RATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CURRENCIES_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// How long an expired quote stays servable once CoinGecko starts
// failing. Rates here are display-only, so a few-hours-old number beats
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

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

interface CachedCurrencies {
  list: string[];
  fetchedAt: number;
}

export interface RatesHealth {
  /** False once a lookup has failed outright with no cached quote to fall back on. */
  ok: boolean;
  /** True while the most recent upstream attempt failed, covered by cache or not. */
  degraded: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Sanitised reason — /status is public, so no URLs or upstream dumps. */
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
  private rateCache = new Map<string, CachedRate>();

  private currenciesCache: CachedCurrencies | null = null;

  // Single-flight guards. A burst of concurrent callers (grcbazaar asks
  // for USD/EUR/GBP in parallel) must not fan out into a burst of
  // CoinGecko calls — that is exactly what earns a 429 on the free tier.
  private inFlightRates = new Map<string, Promise<number>>();

  private inFlightCurrencies: Promise<string[]> | null = null;

  private lastSuccessAt: number | null = null;

  private lastFailureAt: number | null = null;

  private lastError: string | null = null;

  private consecutiveFailures = 0;

  // Explicit flag rather than comparing the two timestamps — success and
  // failure can land in the same millisecond.
  private degraded = false;

  /**
   * Get GRC exchange rate for a fiat currency.
   * Returns the price of 1 GRC in the given currency.
   */
  public async getRate(currency: string): Promise<number> {
    const key = currency.toLowerCase();

    const cached = this.rateCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < RATE_TTL_MS) {
      log.info(`Rate cache hit for ${key}: ${cached.rate}`);
      return cached.rate;
    }

    const inFlight = this.inFlightRates.get(key);
    if (inFlight) return inFlight;

    const pending = this.refreshRate(key, cached)
      .finally(() => this.inFlightRates.delete(key));
    this.inFlightRates.set(key, pending);
    return pending;
  }

  /**
   * Get list of supported fiat currencies from CoinGecko.
   */
  public async getSupportedCurrencies(): Promise<string[]> {
    const cached = this.currenciesCache;
    if (cached && Date.now() - cached.fetchedAt < CURRENCIES_TTL_MS) {
      return cached.list;
    }

    if (this.inFlightCurrencies) return this.inFlightCurrencies;

    const pending = this.refreshCurrencies(cached)
      .finally(() => { this.inFlightCurrencies = null; });
    this.inFlightCurrencies = pending;
    return pending;
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

  private async refreshRate(key: string, cached: CachedRate | undefined): Promise<number> {
    try {
      const supported = await this.getSupportedCurrencies();
      if (!supported.includes(key)) {
        throw new UnsupportedCurrencyError(`Currency "${key}" is not supported`);
      }

      log.info(`Fetching GRC rate for ${key} from CoinGecko`);
      const url = `${COINGECKO_BASE}/simple/price?ids=${GRC_ID}&vs_currencies=${key}`;
      const response = await axios.get(url, { timeout: 10000 });

      const rate = response.data?.[GRC_ID]?.[key];
      if (typeof rate !== 'number' || rate <= 0) {
        throw new Error(`Unable to fetch rate for "${key}"`);
      }

      this.rateCache.set(key, { rate, fetchedAt: Date.now() });
      this.lastSuccessAt = Date.now();
      this.consecutiveFailures = 0;
      this.degraded = false;
      return rate;
    } catch (e: unknown) {
      // An unsupported currency isn't an upstream problem — don't let it
      // pollute the health counters.
      if (e instanceof UnsupportedCurrencyError) throw e;

      this.lastFailureAt = Date.now();
      this.lastError = describeUpstreamError(e);
      this.degraded = true;

      if (cached && Date.now() - cached.fetchedAt < RATE_STALE_MS) {
        const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60000);
        log.warn(`Serving ${ageMin}m-stale ${key} rate after upstream failure: ${e}`);
        return cached.rate;
      }

      this.consecutiveFailures += 1;
      throw e;
    }
  }

  private async refreshCurrencies(cached: CachedCurrencies | null): Promise<string[]> {
    try {
      log.info('Fetching supported currencies from CoinGecko');
      const url = `${COINGECKO_BASE}/simple/supported_vs_currencies`;
      const response = await axios.get(url, { timeout: 10000 });

      if (!Array.isArray(response.data)) {
        throw new Error('Invalid response from CoinGecko supported currencies endpoint');
      }

      this.currenciesCache = { list: response.data, fetchedAt: Date.now() };
      return response.data;
    } catch (e: unknown) {
      if (cached && Date.now() - cached.fetchedAt < CURRENCIES_STALE_MS) {
        log.warn(`Serving stale supported-currencies list after upstream failure: ${e}`);
        return cached.list;
      }
      throw e;
    }
  }
}

export const RatesService = new RatesServiceClass();
