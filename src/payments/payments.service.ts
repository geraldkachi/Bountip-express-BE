import * as crypto from 'crypto';
import { PaymentModel, PaymentEventModel, PaymentStatus, FailureMode, IPayment } from './payment.model';
import { mockCharge, ProviderScenario } from './mock-provider';

export class PaymentsService {

  async initiatePayment(data: {
    tenantId: string; orderId: string; amount: number;
    currency?: string; customerEmail?: string;
  }, scenario: ProviderScenario = 'success') {
    const idempotencyKey = crypto
      .createHash('sha256').update(`${data.tenantId}:${data.orderId}`).digest('hex');

    const existing = await PaymentModel.findOne({ idempotencyKey });
    if (existing) return { payment: existing, duplicate: true };

    let payment: IPayment;
    try {
      payment = await PaymentModel.create({
        tenantId: data.tenantId, orderId: data.orderId, idempotencyKey,
        amount: data.amount, currency: data.currency ?? 'NGN',
        customerEmail: data.customerEmail ?? '', status: PaymentStatus.INITIATED,
      });
    } catch (e: any) {
      if (e.code === 11000) {
        const race = await PaymentModel.findOne({ idempotencyKey });
        return { payment: race!, duplicate: true };
      }
      throw e;
    }

    await this.emit(String(payment._id), data.tenantId, 'initiated', { amount: data.amount });

    try {
      const response = await Promise.race([
        mockCharge(idempotencyKey, scenario),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('Gateway timeout'), { code: 'ETIMEDOUT' })), 5000),
        ),
      ]);

      return response.success
        ? this.confirm(payment, response.reference!)
        : this.fail(payment, FailureMode.PROVIDER_ERROR, response.message ?? 'Provider declined');
    } catch (e: any) {
      return this.fail(
        payment,
        e.code === 'ETIMEDOUT' ? FailureMode.PROVIDER_TIMEOUT : FailureMode.NETWORK_FAILURE,
        e.message,
      );
    }
  }

  private async confirm(p: IPayment, ref: string) {
    p.status = PaymentStatus.CONFIRMED;
    p.providerReference = ref;
    p.providerStatus = 'success';
    const saved = await p.save();
    await this.emit(String(p._id), p.tenantId, 'confirmed', { providerReference: ref });
    return { payment: saved, duplicate: false };
  }

  private async fail(p: IPayment, mode: FailureMode, reason: string) {
    p.status = mode === FailureMode.PROVIDER_TIMEOUT ? PaymentStatus.TIMEOUT : PaymentStatus.FAILED;
    p.failureMode = mode;
    p.failureReason = reason;
    const saved = await p.save();
    await this.emit(String(p._id), p.tenantId, mode === FailureMode.PROVIDER_TIMEOUT ? 'timeout' : 'failed', { failureMode: mode, reason });
    return { payment: saved, duplicate: false };
  }

  private emit(paymentId: string, tenantId: string, eventType: string, metadata: Record<string, any>) {
    return PaymentEventModel.create({ paymentId, tenantId, eventType, metadata });
  }

  async reconcile(tenantId: string, providerTransactions: Array<{ reference: string; status: string; amount: number }>) {
    const providerMap = new Map(providerTransactions.map(t => [t.reference, t]));
    const internal    = await PaymentModel.find({ tenantId });
    const discrepancies: any[] = [];
    const matched: any[] = [];

    for (const p of internal) {
      if (!p.providerReference) {
        if ([PaymentStatus.INITIATED, PaymentStatus.TIMEOUT].includes(p.status)) {
          discrepancies.push({
            type: 'MISSING_PROVIDER_REF', internalId: p._id, orderId: p.orderId,
            status: p.status, amount: p.amount,
            message: 'Payment initiated but no provider reference recorded',
          });
        }
        continue;
      }
      const txn = providerMap.get(p.providerReference);
      if (!txn) {
        discrepancies.push({ type: 'MISSING_IN_PROVIDER', internalId: p._id, orderId: p.orderId, providerReference: p.providerReference, internalStatus: p.status, message: 'Internal reference not found in provider' });
        continue;
      }
      providerMap.delete(p.providerReference);

      const statusMismatch = (txn.status === 'success' && p.status !== PaymentStatus.CONFIRMED) || (txn.status === 'failed' && p.status === PaymentStatus.CONFIRMED);
      const amountMismatch = Math.abs(Number(txn.amount) - Number(p.amount)) > 0.01;

      if (statusMismatch || amountMismatch) {
        discrepancies.push({
          type: statusMismatch ? 'STATUS_MISMATCH' : 'AMOUNT_MISMATCH',
          internalId: p._id, orderId: p.orderId, providerReference: p.providerReference,
          internalStatus: p.status, providerStatus: txn.status,
          internalAmount: p.amount, providerAmount: txn.amount,
          message: statusMismatch
            ? `Provider shows ${txn.status} but internal is ${p.status}`
            : `Amount mismatch: internal=${p.amount}, provider=${txn.amount}`,
        });
      } else {
        matched.push({ internalId: p._id, providerReference: p.providerReference });
      }
    }

    for (const [ref, txn] of providerMap) {
      discrepancies.push({ type: 'PROVIDER_ONLY', reference: ref, providerStatus: txn.status, amount: txn.amount, message: 'Provider transaction with no internal record' });
    }

    return {
      reconciledAt: new Date().toISOString(), tenantId,
      summary: { totalInternal: internal.length, totalProvider: providerTransactions.length, matched: matched.length, discrepancies: discrepancies.length },
      matched, discrepancies,
    };
  }

  getPayments(tenantId: string) {
    return PaymentModel.find({ tenantId }).sort({ initiatedAt: -1 }).limit(50);
  }

  getPaymentEvents(paymentId: string) {
    return PaymentEventModel.find({ paymentId }).sort({ createdAt: 1 });
  }
}
