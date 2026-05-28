import { v4 as uuidv4 } from 'uuid';
import { SyncOperationModel, OperationStatus } from './sync.model';

export interface SyncOperationInput {
  idempotencyKey:  string;
  sequenceNumber:  number;
  operationType:   string;
  payload:         Record<string, any>;
  clientTimestamp: string;
}

export interface SyncBatchInput {
  tenantId:   string;
  clientId:   string;
  operations: SyncOperationInput[];
}

export interface SyncResult {
  idempotencyKey: string;
  status: 'accepted' | 'rejected' | 'merged' | 'duplicate';
  message?: string;
  resolvedPayload?: Record<string, any>;
}

/**
 * Conflict Resolution — SERVER-WINS with MERGE annotation
 * See NestJS implementation for full strategy notes.
 * Identical business logic, different DI mechanism (direct instantiation vs IoC).
 */
export class SyncService {
  async processBatch(dto: SyncBatchInput) {
    const batchId = uuidv4();
    const sorted  = [...dto.operations].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const results: SyncResult[] = [];

    for (const op of sorted) {
      results.push(await this.processOperation(dto.tenantId, dto.clientId, op));
    }

    const summary = {
      accepted:   results.filter(r => r.status === 'accepted').length,
      rejected:   results.filter(r => r.status === 'rejected').length,
      merged:     results.filter(r => r.status === 'merged').length,
      duplicates: results.filter(r => r.status === 'duplicate').length,
    };

    return { batchId, processedAt: new Date().toISOString(), results, summary };
  }

  private async processOperation(tenantId: string, clientId: string, op: SyncOperationInput): Promise<SyncResult> {
    const existing = await SyncOperationModel.findOne({ idempotencyKey: op.idempotencyKey });
    if (existing) {
      return { idempotencyKey: op.idempotencyKey, status: 'duplicate', message: 'Already processed; idempotency enforced.' };
    }

    if (op.operationType === 'ITEM_SOLD' || op.operationType === 'STOCK_ADJUSTED') {
      const conflict = await this.detectConflict(tenantId, op);
      if (conflict) return this.resolveConflict(tenantId, clientId, op, conflict);
    }

    await SyncOperationModel.create({
      tenantId, clientId,
      sequenceNumber: op.sequenceNumber,
      operationType:  op.operationType,
      payload:        op.payload,
      idempotencyKey: op.idempotencyKey,
      status:         OperationStatus.ACCEPTED,
      clientTimestamp: new Date(op.clientTimestamp),
    });

    return { idempotencyKey: op.idempotencyKey, status: 'accepted' };
  }

  private async detectConflict(tenantId: string, op: SyncOperationInput) {
    const { itemId } = op.payload;
    if (!itemId) return null;
    const found = await SyncOperationModel.findOne(
      {
        tenantId,
        'payload.itemId': itemId,
        serverTimestamp: { $gt: new Date(op.clientTimestamp) },
        status: OperationStatus.ACCEPTED,
      },
      null,
      { sort: { serverTimestamp: -1 } },
    );
    return found ? { conflictingOp: found } : null;
  }

  private async resolveConflict(tenantId: string, clientId: string, op: SyncOperationInput, conflict: any): Promise<SyncResult> {
    const qty = op.payload.quantity ?? 0;

    if (qty <= 0) {
      await SyncOperationModel.create({
        tenantId, clientId, sequenceNumber: op.sequenceNumber,
        operationType: op.operationType, payload: op.payload,
        idempotencyKey: op.idempotencyKey, status: OperationStatus.REJECTED,
        conflictDetails: { reason: 'invalid_quantity', conflict },
        clientTimestamp: new Date(op.clientTimestamp),
      });
      return { idempotencyKey: op.idempotencyKey, status: 'rejected', message: 'Conflict: stock modified by another client. Rejected.' };
    }

    const mergedPayload = { ...op.payload, mergedDueToConflict: true, originalQuantity: qty };
    await SyncOperationModel.create({
      tenantId, clientId, sequenceNumber: op.sequenceNumber,
      operationType: op.operationType, payload: mergedPayload,
      idempotencyKey: op.idempotencyKey, status: OperationStatus.MERGED,
      conflictDetails: conflict, clientTimestamp: new Date(op.clientTimestamp),
    });
    return {
      idempotencyKey: op.idempotencyKey, status: 'merged',
      message: 'Concurrent modification detected. Accepted with conflict annotation.',
      resolvedPayload: mergedPayload,
    };
  }

  async getOperations(tenantId: string, clientId?: string) {
    const filter: Record<string, any> = { tenantId };
    if (clientId) filter.clientId = clientId;
    return SyncOperationModel.find(filter).sort({ serverTimestamp: -1 }).limit(100);
  }
}
