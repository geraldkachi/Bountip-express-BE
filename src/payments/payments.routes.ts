import { Router, Request, Response, NextFunction } from 'express';
import { PaymentsService } from './payments.service';
import type { ProviderScenario } from './mock-provider';

const router  = Router();
const service = new PaymentsService();
const h = (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// POST /api/payments/initiate?scenario=success|timeout|provider_error|network_failure
router.post('/initiate', h(async (req: Request, res: Response) => {
  const scenario = (req.query.scenario as ProviderScenario) ?? 'success';
  res.json(await service.initiatePayment(req.body, scenario));
}));

router.get('/:tenantId',                       h(async (req: Request, res: Response) => res.json(await service.getPayments(req.params.tenantId))));
router.get('/:tenantId/:paymentId/events',     h(async (req: Request, res: Response) => res.json(await service.getPaymentEvents(req.params.paymentId))));
router.post('/:tenantId/reconcile',            h(async (req: Request, res: Response) => res.json(await service.reconcile(req.params.tenantId, req.body.providerTransactions ?? []))));

export default router;
