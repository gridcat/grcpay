import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

vi.mock('../../../src/lib/gridcoin', () => ({
  rpc: { getWalletInfo: vi.fn() },
  connect: vi.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line import/first
import { app } from '../../../src/api';
// eslint-disable-next-line import/first
import { setupTestDb } from '../../helpers/db';
// eslint-disable-next-line import/first
import { RatesService } from '../../../src/services/rates/ratesService';

const request = supertest(app);

describe('GET /rates/:currency', () => {
  beforeAll(setupTestDb);
  beforeEach(() => {
    vi.clearAllMocks();
    (RatesService as any).rateCache = new Map();
    (RatesService as any).currenciesCache = null;
    (RatesService as any).inFlightRates = new Map();
    (RatesService as any).inFlightCurrencies = null;
  });

  it('returns rate for a valid currency', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: ['eur', 'usd'] })
      .mockResolvedValueOnce({ data: { 'gridcoin-research': { eur: 0.0034 } } });

    const res = await request.get('/rates/eur');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('type', 'rates');
    expect(res.body.data).toHaveProperty('id', 'eur');
    expect(res.body.data.attributes).toHaveProperty('rate', 0.0034);
    expect(res.body.data.attributes).toHaveProperty('ticker', 'grc');
  });

  it('returns 503 when the upstream is unavailable and nothing is cached', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: ['eur', 'usd'] })
      .mockRejectedValueOnce(new Error('Request failed with status code 429'));

    const res = await request.get('/rates/usd');

    expect(res.status).toBe(503);
    expect(res.body.errors[0].title).toMatch(/temporarily unavailable/);
  });

  it('returns 400 for unsupported currency', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: ['eur', 'usd'] });

    const res = await request.get('/rates/xyz');

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].title).toMatch(/not supported/);
  });
});

describe('GET /rates', () => {
  beforeAll(setupTestDb);

  it('returns supported currencies list', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: ['eur', 'usd', 'gbp', 'jpy'] });

    const res = await request.get('/rates');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('type', 'currencies');
    expect(res.body.data.attributes.currencies).toContain('eur');
    expect(res.body.data.attributes.currencies).toContain('usd');
  });
});
