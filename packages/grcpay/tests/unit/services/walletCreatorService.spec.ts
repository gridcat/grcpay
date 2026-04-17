import { WalletsCreatorServiceClass } from '../../../src/services/wallet/walletCreatorService';
import { createMockWalletModel, createMockRpc, createSampleWalletRow } from '../../helpers/mocks';

// Mock the event emitter
const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

describe('WalletsCreatorService', () => {
  let service: WalletsCreatorServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = createMockWalletModel();
    mockRpc = createMockRpc();
    service = new WalletsCreatorServiceClass(mockWallet as any, mockRpc as any);
  });

  it('creates a wallet with a generated address', async () => {
    const row = createSampleWalletRow({ amount_required: BigInt(1000000000) });
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');
    mockWallet.model.create.mockResolvedValue(row);

    const result = await service.createWallet(10);

    expect(mockRpc.getNewAddress).toHaveBeenCalled();
    expect(mockWallet.model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address: 'Sgenerated_address_1234567890abcde',
          status: 'new',
          amount_recieved: 0,
        }),
      }),
    );
    expect(result.address).toBe(row.address);
  });

  it('refills keypool on getNewAddress failure', async () => {
    mockRpc.getNewAddress
      .mockRejectedValueOnce(new Error('keypool depleted'))
      .mockResolvedValueOnce('Srecovery_address_1234567890abcdef');
    mockWallet.model.create.mockResolvedValue(createSampleWalletRow());

    await service.createWallet(5);

    expect(mockRpc.keyPoolRefill).toHaveBeenCalledWith(100);
    expect(mockRpc.getNewAddress).toHaveBeenCalledTimes(2);
  });

  it('throws when amountRequired is falsy', async () => {
    await expect(service.createWallet(0)).rejects.toThrow('Required amount is required');
    expect(mockRpc.getNewAddress).not.toHaveBeenCalled();
  });

  it('throws when generated address is empty', async () => {
    mockRpc.getNewAddress.mockResolvedValue('');
    await expect(service.createWallet(10)).rejects.toThrow('Unable to generate new address');
  });

  it('emits audit log events', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');
    mockWallet.model.create.mockResolvedValue(createSampleWalletRow());

    await service.createWallet(10, 'Srecipient_addr_234567890abcdef12');

    // Should emit: amount_required, status, address, recipient, mode
    // (lifespan_seconds is only emitted when a non-default is provided).
    expect(mockEmit).toHaveBeenCalledTimes(5);
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'amount_required' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'status', newStatus: 'new' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'address' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'recipient' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'mode', newStatus: 'checkout' }));
  });

  it('passes recipient to DB when provided', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');
    mockWallet.model.create.mockResolvedValue(
      createSampleWalletRow({ recipient: 'Srecipient_addr_234567890abcdef12' }),
    );

    await service.createWallet(10, 'Srecipient_addr_234567890abcdef12');

    expect(mockWallet.model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient: 'Srecipient_addr_234567890abcdef12',
        }),
      }),
    );
  });

  it('defaults mode to checkout and lifespan to null', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');
    mockWallet.model.create.mockResolvedValue(createSampleWalletRow());

    await service.createWallet(10);

    expect(mockWallet.model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'checkout',
          lifespan_seconds: null,
        }),
      }),
    );
  });

  it('emits a lifespan_seconds audit log entry when a custom lifespan is supplied', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');
    mockWallet.model.create.mockResolvedValue(createSampleWalletRow());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.createWallet(10, undefined, 'checkout' as any, 3600);

    expect(mockWallet.model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lifespan_seconds: 3600,
        }),
      }),
    );
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      action: 'lifespan_seconds',
      newStatus: '3600',
    }));
  });
});
