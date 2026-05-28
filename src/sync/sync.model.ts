import mongoose, { Schema, Document } from 'mongoose';

export enum OperationType {
  ITEM_SOLD      = 'ITEM_SOLD',
  STOCK_ADJUSTED = 'STOCK_ADJUSTED',
  ORDER_PLACED   = 'ORDER_PLACED',
}

export enum OperationStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  MERGED   = 'MERGED',
}

export interface ISyncOperation extends Document {
  tenantId:        string;
  clientId:        string;
  sequenceNumber:  number;
  operationType:   OperationType;
  payload:         Record<string, any>;
  idempotencyKey:  string;
  status:          OperationStatus;
  conflictDetails: Record<string, any> | null;
  clientTimestamp: Date;
  serverTimestamp: Date;
}

const schema = new Schema<ISyncOperation>(
  {
    tenantId:        { type: String, required: true, index: true },
    clientId:        { type: String, required: true },
    sequenceNumber:  { type: Number, required: true },
    operationType:   { type: String, enum: Object.values(OperationType), required: true },
    payload:         { type: Schema.Types.Mixed, required: true },
    idempotencyKey:  { type: String, required: true, unique: true },
    status:          { type: String, enum: Object.values(OperationStatus), default: OperationStatus.ACCEPTED },
    conflictDetails: { type: Schema.Types.Mixed, default: null },
    clientTimestamp: { type: Date, required: true },
  },
  { collection: 'sync_operations', timestamps: { createdAt: 'serverTimestamp' } },
);

schema.index({ tenantId: 1, clientId: 1 });
schema.index({ tenantId: 1, 'payload.itemId': 1, serverTimestamp: -1 });

export const SyncOperationModel = mongoose.model<ISyncOperation>('SyncOperation', schema);
