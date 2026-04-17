import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Import after mock is set up
import { RatesService } from '../../../src/services/rates/ratesService';

describe('RatesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear private caches via any-cast
    (RatesService as any).rateCache = new Map();
    (RatesService as any).currenciesCache = null;
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
