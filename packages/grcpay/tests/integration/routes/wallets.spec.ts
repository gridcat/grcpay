import supertest from 'supertest';
import { hashToken } from '../../../src/lib/walletToken';
import { WalletStatus } from '../../../src/models/Wallet';

const VALID_TOKEN = 'integration-test-token-raw-value';
const VALID_TOKEN_HASH = hashToken(VALID_TOKEN);

const mockRpc = {
  getWalletInfo: jest.fn(),
  getNewAddress: jest.fn().mockResolvedValue('Snew_address_567890abcdefghijklm12'),
  keyPoolRefill: jest.fn(),
  getReceivedByAddress: jest.fn().mockResolvedValue(0),
  setTXfee: jest.fn(),
  sendToAddress: jest.fn(),
  validateAddress: jest.fn().mockResolvedValue({ isvalid: true }),
};

jest.mock('../../../src/lib/gridcoin', () => ({
  rpc: mockRpc,
  connect: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line import/first
import { app } from '../../../src/api';
// eslint-disable-next-line import/first
import { db } from '../../../src/lib/db';
// eslint-disable-next-line import/first
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const request = supertest(app);

describe('POST /wallets', () => {
  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
    mockRpc.getNewAddress.mockResolvedValue('Snew_address_567890abcdefghijklm12');
    mockRpc.validateAddress.mockResolvedValue({ isvalid: true });
  });

  it('creates a wallet and returns 201 with a one-time access token', async () => {
    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: {
          type: 'wallets',
          attributes: { amountRequired: 10 },
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('type', 'wallets');
    expect(res.body.data.attributes).toHaveProperty('address');
    expect(res.body.data.attributes).toHaveProperty('token');
    expect(typeof res.body.data.attributes.token).toBe('string');
    expect((res.body.data.attributes.token as string).length).toBeGreaterThan(20);

    const row = await db
      .selectFrom('wallets')
      .selectAll()
      .where('address', '=', 'Snew_address_567890abcdefghijklm12')
      .executeTakeFirstOrThrow();
    expect(row.amount_required).toBe(BigInt(1_000_000_000));
    expect(row.status).toBe('new');
  });

  it('creates a wallet with valid base58 recipient', async () => {
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
    const row = await db
      .selectFrom('wallets')
      .selectAll()
      .where('address', '=', 'Snew_address_567890abcdefghijklm12')
      .executeTakeFirstOrThrow();
    expect(row.recipient).toBe('SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz');
  });

  it('returns 400 for missing amountRequired', async () => {
    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: { type: 'wallets', attributes: {} },
      });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('returns 400 for zero amountRequired', async () => {
    const res = await request
      .post('/wallets')
      .set('Content-Type', 'application/vnd.api+json')
      .send({
        data: { type: 'wallets', attributes: { amountRequired: 0 } },
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
          attributes: { amountRequired: 10, recipient: 'invalid' },
        },
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /wallets/:address', () => {
  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
  });

  it('returns wallet when found and token matches', async () => {
    await insertWallet({
      address: 'Sfound_address_234567890abcdefgh12',
      token_hash: VALID_TOKEN_HASH,
    });

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
    await insertWallet({
      address: 'Sfound_address_234567890abcdefgh12',
      token_hash: VALID_TOKEN_HASH,
    });

    const res = await request.get('/wallets/Sfound_address_234567890abcdefgh12');

    expect(res.status).toBe(401);
    expect(res.body.errors).toBeDefined();
  });

  it('returns 401 when the token is wrong', async () => {
    await insertWallet({
      address: 'Sfound_address_234567890abcdefgh12',
      token_hash: VALID_TOKEN_HASH,
    });

    const res = await request
      .get('/wallets/Sfound_address_234567890abcdefgh12')
      .set('X-Wallet-Token', 'not-the-right-token');

    expect(res.status).toBe(401);
  });

  it('returns 401 (not 404) when the wallet does not exist — closes the probe oracle', async () => {
    const res = await request
      .get('/wallets/Snonexistent_1234567890abcdefgh12')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(401);
    expect(res.body.errors).toBeDefined();
  });
});

describe('DELETE /wallets/:address', () => {
  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
  });

  it('cancels a new wallet when the token matches', async () => {
    const row = await insertWallet({
      address: 'Scancel_address_4567890abcdefghij',
      status: WalletStatus.new,
      token_hash: VALID_TOKEN_HASH,
    });

    const res = await request
      .delete('/wallets/Scancel_address_4567890abcdefghij')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(204);
    const after = await db
      .selectFrom('wallets')
      .select(['status'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('expired');
  });

  it('rejects DELETE without a token (401)', async () => {
    await insertWallet({
      address: 'Scancel_address_4567890abcdefghij',
      token_hash: VALID_TOKEN_HASH,
    });

    const res = await request.delete('/wallets/Scancel_address_4567890abcdefghij');

    expect(res.status).toBe(401);
  });

  it('returns 409 when the wallet is not in status new', async () => {
    await insertWallet({
      address: 'Scancel_address_4567890abcdefghij',
      status: WalletStatus.processed,
      token_hash: VALID_TOKEN_HASH,
    });

    const res = await request
      .delete('/wallets/Scancel_address_4567890abcdefghij')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(409);
  });

  it('returns 401 when wallet not found (probe-oracle protection)', async () => {
    const res = await request
      .delete('/wallets/Snonexistent_1234567890abcdefgh12')
      .set('X-Wallet-Token', VALID_TOKEN);

    expect(res.status).toBe(401);
  });
});

describe('GET /wallets/:address/qr', () => {
  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
  });

  // base58 omits 0, O, I, l — sticking to a-k m-z 1-9 here so the
  // shape regex in the controller accepts the fixture.
  const KNOWN_ADDR = 'S5qrAddr678923abcdefghijkmnopqrstu';
  const UNKNOWN_ADDR = 'S5nonexistent789abcdefghijkmnopqrs';

  it('returns QR code for existing wallet', async () => {
    await insertWallet({
      address: KNOWN_ADDR,
      amount_required: BigInt(1_000_000_000),
      amount_recieved: BigInt(0),
    });

    const res = await request.get(`/wallets/${KNOWN_ADDR}/qr`);

    expect(res.status).toBe(200);
    expect(res.body.data.attributes).toHaveProperty('qr');
    expect(res.body.data.attributes.qr).toMatch(/^data:image\/png;base64,/);
  });

  // Unmanaged addresses must look exactly like managed-but-fully-funded
  // ones from the outside — a 200 with a `data:image/png` payload — so
  // the endpoint can't be used as a yes/no oracle for "does this grcpay
  // mint this address?".
  it('returns plain-address QR (200) for unknown wallet', async () => {
    const res = await request.get(`/wallets/${UNKNOWN_ADDR}/qr`);

    expect(res.status).toBe(200);
    expect(res.body.data.attributes).toHaveProperty('qr');
    expect(res.body.data.attributes.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects malformed addresses with 400', async () => {
    const res = await request.get('/wallets/not-an-address/qr');

    expect(res.status).toBe(400);
  });
});
