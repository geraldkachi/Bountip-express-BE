import { SyncService } from '../sync.service';
import { SyncOperationModel, OperationStatus } from '../sync.model';

jest.mock('../sync.model');

const SyncModelMock = SyncOperationModel as jest.Mocked<typeof SyncOperationModel>;

describe('SyncService (Express)', () => {
  let service: SyncService;

  beforeEach(() => {
    service = new SyncService();
    jest.clearAllMocks();
  });

  // ─── Clean sync ─────────────────────────────────────────────────────────────

  describe('Clean Sync', () => {
    it('accepts all operations with no conflicts', async () => {
      (SyncModelMock.findOne as any).mockResolvedValue(null);
      (SyncModelMock.create as any).mockResolvedValue({ status: OperationStatus.ACCEPTED });

      const result = await service.processBatch({
        tenantId: 'tenant_001', clientId: 'pos_01',
        operations: [
          { idempotencyKey: 'k1', sequenceNumber: 1, operationType: 'ITEM_SOLD',
            payload: { itemId: 'i1', quantity: 2 }, clientTimestamp: new Date().toISOString() },
          { idempotencyKey: 'k2', sequenceNumber: 2, operationType: 'ORDER_PLACED',
            payload: { orderId: 'o1' }, clientTimestamp: new Date().toISOString() },
        ],
      });

      expect(result.summary.accepted).toBe(2);
      expect(result.summary.rejected).toBe(0);
      expect(result.summary.merged).toBe(0);
      expect(result.summary.duplicates).toBe(0);
    });

    it('sorts by sequenceNumber before processing', async () => {
      (SyncModelMock.findOne as any).mockResolvedValue(null);
      const order: number[] = [];
      (SyncModelMock.create as any).mockImplementation((doc: any) => {
        order.push(doc.sequenceNumber);
        return Promise.resolve(doc);
      });

      await service.processBatch({
        tenantId: 't', clientId: 'c',
        operations: [
          { idempotencyKey: 'k3', sequenceNumber: 3, operationType: 'ORDER_PLACED', payload: {}, clientTimestamp: new Date().toISOString() },
          { idempotencyKey: 'k1', sequenceNumber: 1, operationType: 'ORDER_PLACED', payload: {}, clientTimestamp: new Date().toISOString() },
          { idempotencyKey: 'k2', sequenceNumber: 2, operationType: 'ORDER_PLACED', payload: {}, clientTimestamp: new Date().toISOString() },
        ],
      });

      expect(order).toEqual([1, 2, 3]);
    });
  });

  // ─── Conflict scenario ───────────────────────────────────────────────────────

  describe('Conflict Scenario', () => {
    it('merges a concurrent ITEM_SOLD on the same item', async () => {
      (SyncModelMock.findOne as any)
        .mockResolvedValueOnce(null)   // idempotency check
        .mockResolvedValueOnce({ _id: 'other', payload: { itemId: 'i1', quantity: 5 }, status: OperationStatus.ACCEPTED });
      (SyncModelMock.create as any).mockResolvedValue({ status: OperationStatus.MERGED });

      const result = await service.processBatch({
        tenantId: 'tenant_001', clientId: 'pos_01',
        operations: [{
          idempotencyKey: 'kc', sequenceNumber: 1, operationType: 'ITEM_SOLD',
          payload: { itemId: 'i1', quantity: 2 },
          clientTimestamp: new Date(Date.now() - 5000).toISOString(),
        }],
      });

      expect(result.summary.merged).toBe(1);
      expect(result.results[0].status).toBe('merged');
      expect(result.results[0].resolvedPayload?.mergedDueToConflict).toBe(true);
    });

    it('enforces idempotency — duplicate is detected without re-saving', async () => {
      (SyncModelMock.findOne as any).mockResolvedValue({ _id: 'dup', idempotencyKey: 'kdup' });

      const result = await service.processBatch({
        tenantId: 't', clientId: 'c',
        operations: [{ idempotencyKey: 'kdup', sequenceNumber: 1, operationType: 'ORDER_PLACED', payload: {}, clientTimestamp: new Date().toISOString() }],
      });

      expect(result.summary.duplicates).toBe(1);
      expect(result.results[0].status).toBe('duplicate');
      expect(SyncModelMock.create).not.toHaveBeenCalled();
    });
  });
});
