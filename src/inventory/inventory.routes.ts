import { Router, Request, Response, NextFunction } from 'express';
import { InventoryService } from './inventory.service';
import { MovementType } from './inventory.model';

const router  = Router();
const service = new InventoryService();
const h = (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.post('/tenants',                                         h(async (req: Request, res: Response) => res.status(201).json(await service.createTenant(req.body))));
router.get('/tenants',                                          h(async (_: Request, res: Response)   => res.json(await service.getTenants())));
router.post('/tenants/:tenantId/items',                         h(async (req: Request, res: Response) => res.status(201).json(await service.createStockItem(req.params.tenantId, req.body))));
router.patch('/tenants/:tenantId/items/:itemId',                h(async (req: Request, res: Response) => res.json(await service.updateStockItem(req.params.tenantId, req.params.itemId, req.body))));
router.get('/tenants/:tenantId/items',                          h(async (req: Request, res: Response) => res.json(await service.getStockLevels(req.params.tenantId))));
router.get('/tenants/:tenantId/items/low-stock',                h(async (req: Request, res: Response) => res.json(await service.getLowStockItems(req.params.tenantId))));
router.post('/tenants/:tenantId/items/:itemId/movements',       h(async (req: Request, res: Response) => res.status(201).json(await service.recordMovement(req.params.tenantId, req.params.itemId, req.body))));
router.get('/tenants/:tenantId/items/:itemId/movements',        h(async (req: Request, res: Response) => res.json(await service.getMovementHistory(req.params.tenantId, req.params.itemId))));
router.get('/aggregate/:parentTenantId',                        h(async (req: Request, res: Response) => res.json(await service.getAggregateStockLevels(req.params.parentTenantId))));

export default router;
