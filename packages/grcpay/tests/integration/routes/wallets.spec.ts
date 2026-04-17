import supertest from 'supertest';
import { createSampleWalletRow } from '../../helpers/mocks';
import { hashToken } from '../../../src/lib/walletToken';

const VALID_TOKEN = 'integration-test-token-raw-value';
const VALID_TOKEN_HASH = hashToken(VALID_TOKEN);

const mockPrismaWallets = {
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};

jest.mock('../../../src/lib/prisma', () => ({
  getPrisma: () => ({
    wallets: mockPrismaWallets,
    db_logs: {
      create: jest.fn().mockResolvedValue({}),
    },
  }),
  disconnect: jest.fn(),
}));

const mockRpc = {
  getWalletInfo: jest.fn(),
  getNewAddress: jest.fn().mockResolvedValue('Snew_address_567890abcdefghijklm12'),
  keyPoolRefill: jest.fn(),
  getReceivedByAddress: jest.fn().mockResolvedValue(0),
  setTXfee: jest.fn(),
  sendToAddress: jest.fn(),
};

jest.mock('../../../src/lib/gridcoin', () => ({
  rpc: mockRpc,
  connect: jest.fn().mockResolvedValue(true),
}));

import { app } from '../../../src/api';

const request = supertest(app);

describe('POST /wallets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.getNewAddress.mockResolvedValue('Snew_address_567890abcdefghijklm12');
  });

  it('creates a wallet and returns 201 with a one-time access token', async () => {
    const row = createSampleWalletRow({
      address: 'Snew_address_567890abcdefghijklm12',
      amount_required: BigInt(1000000000),
    });
    mockPrismaWallets.create.mockResolvedValue(row);

    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: {
          type: 'wallets',
          attributes: {
            amountRequired: 10,
          },
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('type', 'wallets');
    expect(res.body.data.attributes).toHaveProperty('address');
    // The raw access token is revealed exactly once in the POST
    // response; the merchant captures it and uses it on subsequent
    // GETs and DELETEs.
    expect(res.body.data.attributes).toHaveProperty('token');
    expect(typeof res.body.data.attributes.token).toBe('string');
    expect((res.body.data.attributes.token as string).length).toBeGreaterThan(20);
  });

  it('creates a wallet with valid base58 recipient', async () => {
    const row = createSampleWalletRow({
      address: 'Snew_address_567890abcdefghijklm12',
      recipient: 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz',
    });
    mockPrismaWallets.create.mockResolvedValue(row);

    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: {
          type: 'wallets',
          attributes: {
            amountRequired: 10,
            recipient: 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz',
          },
        },
      });

    expect(res.status).toBe(201);
  });

  it('returns 400 for missing amountRequired', async () => {
    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: {
          type: 'wallets',
          attributes: {},
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('returns 400 for zero amountRequired', async () => {
    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: {
          type: 'wallets',
          attributes: {
            amountRequired: 0,
          },
        },
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid recipient format', async () => {
    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: {
          type: 'wallets',
          attributes: {
            amountRequired: 10,
            recipient: 'invalid',
          },
        },
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /wallets/:address', () => {
  it('returns wallet when found and token matches', async () => {
    const row = createSampleWalletRow({
      address: 'Sfound_address_234567890abcdefgh12',
      token_hash: VALID_TOKEN_HASH,
    });
    mockPrismaWallets.findFirst.mockResolvedValue(row);

    const res = await request
      .get('/wallets/Sfound_address_234567890abcdefgh12')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('type', 'wallets');
    expect(res.body.data.attributes).toHaveProperty('address', 'Sfound_address_234567890abcdefgh12');
    // GETs must NOT echo the raw token back — it's a one-time reveal
    // on the creation response only.
    expect(res.body.data.attributes).not.toHaveProperty('token');
  });

  it('returns 401 when the X-Wallet-Token header is missing', async () => {
    const row = createSampleWalletRow({
      address: 'Sfound_address_234567890abcdefgh12',
      token_hash: VALID_TOKEN_HASH,
    });
    mockPrismaWallets.findFirst.mockResolvedValue(row);

    const res = await request.get('/wallets/Sfound_address_234567890abcdefgh12');

    expect(res.status).toBe(401);
    expect(res.body.errors).toBeDefined();
  });

  it('returns 401 when the token is wrong', async () => {
    const row = createSampleWalletRow({
      address: 'Sfound_address_234567890abcdefgh12',
      token_hash: VALID_TOKEN_HASH,
    });
    mockPrismaWallets.findFirst.mockResolvedValue(row);

    const res = await request
      .get('/wallets/Sfound_address_234567890abcdefgh12')
      .set('X-Wallet-Token', 'not-the-right-token');

    expect(res.status).toBe(401);
  });

  it('returns 404 when wallet not found', async () => {
    mockPrismaWallets.findFirst.mockResolvedValue(null);

    const res = await request
      .get('/wallets/Snonexistent_1234567890abcdefgh12')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.errors).toBeDefined();
  });
});

describe('DELETE /wallets/:address', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('cancels a new wallet when the token matches', async () => {
    const row = createSampleWalletRow({
      address: 'Scancel_address_4567890abcdefghij',
      status: 'new',
      token_hash: VALID_TOKEN_HASH,
    });
    mockPrismaWallets.findFirst.mockResolvedValue(row);
    mockPrismaWallets.update.mockResolvedValue({ ...row, status: 'expired' });

    const res = await request
      .delete('/wallets/Scancel_address_4567890abcdefghij')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(204);
    expect(mockPrismaWallets.update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: { status: 'expired' },
    });
  });

  it('rejects DELETE without a token (401)', async () => {
    const row = createSampleWalletRow({
      address: 'Scancel_address_4567890abcdefghij',
      token_hash: VALID_TOKEN_HASH,
    });
    mockPrismaWallets.findFirst.mockResolvedValue(row);

    const res = await request.delete('/wallets/Scancel_address_4567890abcdefghij');

    expect(res.status).toBe(401);
    expect(mockPrismaWallets.update).not.toHaveBeenCalled();
  });

  it('returns 409 when the wallet is not in status new', async () => {
    const row = createSampleWalletRow({
      address: 'Scancel_address_4567890abcdefghij',
      status: 'processed',
      token_hash: VALID_TOKEN_HASH,
    });
    mockPrismaWallets.findFirst.mockResolvedValue(row);

    const res = await request
      .delete('/wallets/Scancel_address_4567890abcdefghij')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(409);
    expect(mockPrismaWallets.update).not.toHaveBeenCalled();
  });

  it('returns 404 when wallet not found', async () => {
    mockPrismaWallets.findFirst.mockResolvedValue(null);

    const res = await request
      .delete('/wallets/Snonexistent_1234567890abcdefgh12')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(404);
  });
});

describe('GET /wallets/:address/qr', () => {
  it('returns QR code for existing wallet', async () => {
    const row = createSampleWalletRow({
      address: 'SqrAddr_34567890abcdefghijklmnop12',
      amount_required: BigInt(1000000000),
      amount_recieved: BigInt(0),
    });
    mockPrismaWallets.findFirst.mockResolvedValue(row);

    const res = await request.get('/wallets/SqrAddr_34567890abcdefghijklmnop12/qr');

    expect(res.status).toBe(200);
    expect(res.body.data.attributes).toHaveProperty('qr');
    expect(res.body.data.attributes.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('returns 404 for non-existent wallet', async () => {
    mockPrismaWallets.findFirst.mockResolvedValue(null);

    const res = await request.get('/wallets/Snonexistent_1234567890abcdefgh12/qr');

    expect(res.status).toBe(404);
  });
});
