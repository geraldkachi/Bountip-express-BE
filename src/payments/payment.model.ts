import mongoose, { Schema, Document } from 'mongoose';

export enum PaymentStatus {
  INITIATED = 'INITIATED', CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED', REFUNDED = 'REFUNDED', TIMEOUT = 'TIMEOUT',
}
export enum FailureMode {
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
  PROVIDER_ERROR   = 'PROVIDER_ERROR',
  NETWORK_FAILURE  = 'NETWORK_FAILURE',
}

export interface IPayment extends Document {
  tenantId: string; orderId: string; idempotencyKey: string;
  amount: number; currency: string; customerEmail: string;
  status: PaymentStatus;
  providerReference: string | null; providerStatus: string | null;
  failureMode: FailureMode | null; failureReason: string | null;
  providerResponse: Record<string, any> | null;
  initiatedAt: Date; updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    tenantId:          { type: String, required: true, index: true },
    orderId:           { type: String, required: true },
    idempotencyKey:    { type: String, required: true, unique: true },
    amount:            { type: Number, required: true },
    currency:          { type: String, default: 'NGN' },
    customerEmail:     { type: String, default: '' },
    status:            { type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.INITIATED },
    providerReference: { type: String, default: null },
    providerStatus:    { type: String, default: null },
    failureMode:       { type: String, enum: [...Object.values(FailureMode), null], default: null },
    failureReason:     { type: String, default: null },
    providerResponse:  { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'payments', timestamps: { createdAt: 'initiatedAt', updatedAt: 'updatedAt' } },
);
paymentSchema.index({ tenantId: 1, orderId: 1 }, { unique: true });
paymentSchema.index({ tenantId: 1, status: 1 });

export const PaymentModel = mongoose.model<IPayment>('Payment', paymentSchema);

export interface IPaymentEvent extends Document {
  paymentId: string; tenantId: string;
  eventType: string; metadata: Record<string, any> | null;
  createdAt: Date;
}

const eventSchema = new Schema<IPaymentEvent>(
  {
    paymentId: { type: String, required: true, index: true },
    tenantId:  { type: String, required: true },
    eventType: { type: String, required: true },
    metadata:  { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'payment_events', timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ paymentId: 1, createdAt: -1 });
export const PaymentEventModel = mongoose.model<IPaymentEvent>('PaymentEvent', eventSchema);
