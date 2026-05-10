import axios from 'axios';
import { log } from '../../lib/log';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const GRC_ID = 'gridcoin-research';
const RATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CURRENCIES_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

interface CachedCurrencies {
  list: string[];
  fetchedAt: number;
}

class RatesServiceClass {
  private rateCache = new Map<string, CachedRate>();

  private currenciesCache: CachedCurrencies | null = null;

  /**
   * Get GRC exchange rate for a fiat currency.
   * Returns the price of 1 GRC in the given currency.
   */
  public async getRate(currency: string): Promise<number> {
    const key = currency.toLowerCase();

    // Check cache
    const cached = this.rateCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < RATE_TTL_MS) {
      log.info(`Rate cache hit for ${key}: ${cached.rate}`);
      return cached.rate;
    }

    // Validate currency
    const supported = await this.getSupportedCurrencies();
    if (!supported.includes(key)) {
      throw new Error(`Currency "${key}" is not supported`);
    }

    // Fetch from CoinGecko
    log.info(`Fetching GRC rate for ${key} from CoinGecko`);
    const url = `${COINGECKO_BASE}/simple/price?ids=${GRC_ID}&vs_currencies=${key}`;
    const response = await axios.get(url, { timeout: 10000 });

    const rate = response.data?.[GRC_ID]?.[key];
    if (typeof rate !== 'number' || rate <= 0) {
      throw new Error(`Unable to fetch rate for "${key}"`);
    }

    this.rateCache.set(key, { rate, fetchedAt: Date.now() });
    return rate;
  }

  /**
   * Get list of supported fiat currencies from CoinGecko.
   */
  public async getSupportedCurrencies(): Promise<string[]> {
    if (this.currenciesCache && Date.now() - this.currenciesCache.fetchedAt < CURRENCIES_TTL_MS) {
      return this.currenciesCache.list;
    }

    log.info('Fetching supported currencies from CoinGecko');
    const url = `${COINGECKO_BASE}/simple/supported_vs_currencies`;
    const response = await axios.get(url, { timeout: 10000 });

    if (!Array.isArray(response.data)) {
      throw new Error('Invalid response from CoinGecko supported currencies endpoint');
    }

    this.currenciesCache = { list: response.data, fetchedAt: Date.now() };
    return response.data;
  }
}

export const RatesService = new RatesServiceClass();
