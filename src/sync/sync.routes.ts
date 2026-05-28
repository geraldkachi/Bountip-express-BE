import { Router, Request, Response, NextFunction } from 'express';
import { SyncService } from './sync.service';

const router  = Router();
const service = new SyncService();

// POST /api/sync/batch
router.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.processBatch(req.body);
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/sync/operations?tenantId=&clientId=
router.get('/operations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, clientId } = req.query as { tenantId: string; clientId?: string };
    if (!tenantId) { res.status(400).json({ message: 'tenantId is required' }); return; }
    const ops = await service.getOperations(tenantId, clientId);
    res.json(ops);
  } catch (e) { next(e); }
});

export default router;
