import { PaymentsService } from '../payments.service';
import { PaymentModel, PaymentEventModel, PaymentStatus, FailureMode } from '../payment.model';
import * as mockProviderModule from '../mock-provider';

jest.mock('../payment.model');
jest.mock('../mock-provider');

const PaymentMock      = PaymentModel      as jest.Mocked<typeof PaymentModel>;
const PaymentEventMock = PaymentEventModel as jest.Mocked<typeof PaymentEventModel>;
const mockCharge       = mockProviderModule.mockCharge as jest.Mock;

const makePayment = (overrides: any = {}) => ({
  _id: 'pay_001', tenantId: 'tenant_001', orderId: 'order_001',
  idempotencyKey: 'idem', amount: 15000, currency: 'NGN', customerEmail: 'x@x.com',
  status: PaymentStatus.INITIATED, providerReference: null,
  failureMode: null, failureReason: null, providerResponse: null,
  save: jest.fn().mockImplementation(function (this: any) { return Promise.resolve(this); }),
  ...overrides,
});

describe('PaymentsService (Express)', () => {
  let service: PaymentsService;

  beforeEach(() => {
    service = new PaymentsService();
    jest.clearAllMocks();
    (PaymentEventMock.create as any).mockResolvedValue({});
  });

  // ─── Task 3: happy path ────────────────────────────────────────────────────

  describe('Successful payment', () => {
    it('initiates, calls provider, confirms, and emits both events', async () => {
      const payment = makePayment();
      (PaymentMock.findOne as any).mockResolvedValue(null);
      (PaymentMock.create as any).mockResolvedValue(payment);
      mockCharge.mockResolvedValue({ success: true, reference: 'mock_abc123456789' });

      const result = await service.initiatePayment(
        { tenantId: 'tenant_001', orderId: 'order_new', amount: 15000 }, 'success',
      );

      expect(result.duplicate).toBe(false);
      expect(result.payment.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.payment.providerReference).toContain('mock_');
      // Both audit events written to durable log
      expect(PaymentEventMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'initiated' }),
      );
      expect(PaymentEventMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'confirmed' }),
      );
    });
  });

  // ─── Task 3: idempotency ───────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('returns existing payment without calling provider on retry', async () => {
      (PaymentMock.findOne as any).mockResolvedValue(makePayment({ status: PaymentStatus.CONFIRMED }));

      const result = await service.initiatePayment({ tenantId: 't', orderId: 'o', amount: 100 });

      expect(result.duplicate).toBe(true);
      expect(mockCharge).not.toHaveBeenCalled();
    });
  });

  // ─── Task 3: three failure modes ──────────────────────────────────────────

  describe('Failure modes', () => {
    const setup = () => {
      (PaymentMock.findOne as any).mockResolvedValue(null);
      (PaymentMock.create as any).mockResolvedValue(makePayment());
    };

    it('PROVIDER_TIMEOUT → TIMEOUT status', async () => {
      setup();
      mockCharge.mockRejectedValue(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
      const r = await service.initiatePayment({ tenantId: 't', orderId: 'o1', amount: 100 }, 'timeout');
      expect(r.payment.status).toBe(PaymentStatus.TIMEOUT);
      expect(r.payment.failureMode).toBe(FailureMode.PROVIDER_TIMEOUT);
    });

    it('PROVIDER_ERROR (card declined) → FAILED status', async () => {
      setup();
      mockCharge.mockResolvedValue({ success: false, message: 'Declined' });
      const r = await service.initiatePayment({ tenantId: 't', orderId: 'o2', amount: 100 }, 'provider_error');
      expect(r.payment.status).toBe(PaymentStatus.FAILED);
      expect(r.payment.failureMode).toBe(FailureMode.PROVIDER_ERROR);
    });

    it('NETWORK_FAILURE → FAILED status', async () => {
      setup();
      mockCharge.mockRejectedValue(Object.assign(new Error('unreachable'), { code: 'ECONNREFUSED' }));
      const r = await service.initiatePayment({ tenantId: 't', orderId: 'o3', amount: 100 }, 'network_failure');
      expect(r.payment.status).toBe(PaymentStatus.FAILED);
      expect(r.payment.failureMode).toBe(FailureMode.NETWORK_FAILURE);
    });
  });

  // ─── Task 3: reconciliation ────────────────────────────────────────────────

  describe('Reconciliation', () => {
    it('detects STATUS_MISMATCH', async () => {
      (PaymentMock.find as any).mockResolvedValue([
        makePayment({ status: PaymentStatus.TIMEOUT, providerReference: 'ref_abc' }),
      ]);
      const r = await service.reconcile('tenant_001', [{ reference: 'ref_abc', status: 'success', amount: 15000 }]);
      expect(r.discrepancies[0].type).toBe('STATUS_MISMATCH');
    });

    it('detects AMOUNT_MISMATCH', async () => {
      (PaymentMock.find as any).mockResolvedValue([
        makePayment({ status: PaymentStatus.CONFIRMED, providerReference: 'ref_xyz', amount: 15000 }),
      ]);
      const r = await service.reconcile('tenant_001', [{ reference: 'ref_xyz', status: 'success', amount: 10000 }]);
      expect(r.discrepancies[0].type).toBe('AMOUNT_MISMATCH');
    });

    it('flags MISSING_PROVIDER_REF for INITIATED with no reference', async () => {
      (PaymentMock.find as any).mockResolvedValue([
        makePayment({ status: PaymentStatus.INITIATED, providerReference: null }),
      ]);
      const r = await service.reconcile('tenant_001', []);
      expect(r.discrepancies[0].type).toBe('MISSING_PROVIDER_REF');
    });

    it('flags PROVIDER_ONLY for transactions not in internal DB', async () => {
      (PaymentMock.find as any).mockResolvedValue([]);
      const r = await service.reconcile('tenant_001', [{ reference: 'ghost', status: 'success', amount: 5000 }]);
      expect(r.discrepancies[0].type).toBe('PROVIDER_ONLY');
    });

    it('summary counts matched and discrepancies correctly', async () => {
      (PaymentMock.find as any).mockResolvedValue([
        makePayment({ status: PaymentStatus.CONFIRMED, providerReference: 'good', amount: 5000 }),
        makePayment({ _id: 'p2', orderId: 'o2', status: PaymentStatus.TIMEOUT, providerReference: 'bad' }),
      ]);
      const r = await service.reconcile('tenant_001', [
        { reference: 'good', status: 'success', amount: 5000 },
        { reference: 'bad',  status: 'success', amount: 5000 },
      ]);
      expect(r.summary.matched).toBe(1);
      expect(r.summary.discrepancies).toBe(1);
    });
  });
});
