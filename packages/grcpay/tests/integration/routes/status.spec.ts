import supertest from 'supertest';

jest.mock('../../../src/lib/gridcoin', () => ({
  rpc: {
    getWalletInfo: jest.fn(),
    getNewAddress: jest.fn(),
    getReceivedByAddress: jest.fn(),
  },
  connect: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line import/first
import { app } from '../../../src/api';
// eslint-disable-next-line import/first
import { setupTestDb } from '../../helpers/db';

const request = supertest(app);

describe('GET /status', () => {
  beforeAll(setupTestDb);

  it('returns 200 with service info', async () => {
    const res = await request.get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('type', 'status');
    expect(res.body.data.attributes).toHaveProperty('name', 'grcpay');
  });

  it('returns JSON:API content type', async () => {
    const res = await request.get('/status');

    expect(res.headers['content-type']).toMatch(/application\/vnd\.api\+json/);
  });
});

describe('404 handling', () => {
  beforeAll(setupTestDb);

  it('returns 404 for unknown routes', async () => {
    const res = await request.get('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].status).toBe(404);
  });
});
