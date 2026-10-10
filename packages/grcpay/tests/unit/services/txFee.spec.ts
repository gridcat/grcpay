import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordTxFee } from '../../../src/services/wallet/txFee';
import { createMockRpc } from '../../helpers/mocks';

const mockEmit = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: vi.fn() }),
}));

// 1078 bytes: the 7-input size where the daemon's per-KB fee doubles.
const HEX_1078_BYTES = 'ab'.repeat(1078);

describe('recordTxFee', () => {
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc = createMockRpc();
  });

  it('logs the charged fee, the reserved fee and the tx size', async () => {
    mockRpc.getTransaction.mockResolvedValue({ fee: -0.002 } as never);
    mockRpc.getRawTransaction.mockResolvedValue(HEX_1078_BYTES as never);

    await recordTxFee(mockRpc as never, 7, 'tx_abc');

    expect(mockRpc.getTransaction).toHaveBeenCalledWith('tx_abc');
    expect(mockRpc.getRawTransaction).toHaveBeenCalledWith('tx_abc', false);
    expect(mockEmit).toHaveBeenCalledWith('log', {
      walletId: 7,
      action: 'tx_fee',
      newStatus: 'tx_abc',
      detail: 'charged 200000 halford, reserved 100000 halford, 1078 bytes',
    });
  });

  it('logs nothing when gettransaction has no fee field', async () => {
    mockRpc.getTransaction.mockResolvedValue({ confirmations: 1 } as never);

    await recordTxFee(mockRpc as never, 7, 'tx_abc');

    expect(mockRpc.getRawTransaction).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('never throws when the daemon fails', async () => {
    mockRpc.getTransaction.mockRejectedValue(new Error('connection refused'));

    await expect(recordTxFee(mockRpc as never, 7, 'tx_abc')).resolves.toBeUndefined();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
