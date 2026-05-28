import { InventoryService } from '../inventory.service';
import { TenantModel, StockItemModel, StockMovementModel, MovementType } from '../inventory.model';

jest.mock('../inventory.model');

const TenantMock    = TenantModel   as jest.Mocked<typeof TenantModel>;
const StockMock     = StockItemModel as jest.Mocked<typeof StockItemModel>;
const MovementMock  = StockMovementModel as jest.Mocked<typeof StockMovementModel>;

const mockItem = (overrides: any = {}) => ({
  _id: 'item_001', tenantId: 'tenant_001',
  sku: 'CHOC-001', name: 'Choc Cake',
  currentQuantity: 20, lowStockThreshold: 5, unit: 'pcs', costPerUnit: 2500,
  save: jest.fn().mockImplementation(function () { return Promise.resolve(this); }),
  ...overrides,
});

describe('InventoryService (Express)', () => {
  let service: InventoryService;

  beforeEach(() => {
    service = new InventoryService();
    jest.clearAllMocks();
  });

  describe('Tenant isolation', () => {
    it('throws 404 when tenant does not exist', async () => {
      (TenantMock.findById as any).mockResolvedValue(null);
      await expect(service.createStockItem('bad_tenant', { sku: 'X', name: 'Y' }))
        .rejects.toMatchObject({ status: 404 });
    });

    it('scopes stock item to the correct tenantId', async () => {
      (TenantMock.findById as any).mockResolvedValue({ _id: 'tenant_001' });
      (StockMock.create as any).mockResolvedValue(mockItem());
      const item = await service.createStockItem('tenant_001', { sku: 'CHOC-001', name: 'Choc Cake' });
      expect(item.tenantId).toBe('tenant_001');
      expect(StockMock.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant_001' }));
    });
  });

  describe('Stock Movements', () => {
    it('records a SALE with correct delta and atomic filter', async () => {
      (StockMock.findOne as any).mockResolvedValue(mockItem({ currentQuantity: 20 }));
      (StockMock.findOneAndUpdate as any).mockResolvedValue(mockItem({ currentQuantity: 17 }));
      (MovementMock.create as any).mockResolvedValue({
        type: MovementType.SALE, quantity: -3, quantityBefore: 20, quantityAfter: 17,
      });

      const mov = await service.recordMovement('tenant_001', 'item_001', {
        type: MovementType.SALE, quantity: 3,
      });

      expect(mov.quantity).toBe(-3);
      expect(mov.quantityBefore).toBe(20);
      expect(mov.quantityAfter).toBe(17);
      expect(StockMock.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ currentQuantity: { $gte: 3 } }),
        expect.objectContaining({ $inc: { currentQuantity: -3 } }),
        expect.any(Object),
      );
    });

    it('throws 400 when stock is insufficient', async () => {
      (StockMock.findOne as any).mockResolvedValue(mockItem({ currentQuantity: 2 }));
      (StockMock.findOneAndUpdate as any).mockResolvedValue(null);
      await expect(service.recordMovement('tenant_001', 'item_001', { type: MovementType.SALE, quantity: 10 }))
        .rejects.toMatchObject({ status: 400 });
    });

    it('records a RESTOCK with positive delta and no stock-guard filter', async () => {
      (StockMock.findOne as any).mockResolvedValue(mockItem({ currentQuantity: 5 }));
      (StockMock.findOneAndUpdate as any).mockResolvedValue(mockItem({ currentQuantity: 25 }));
      (MovementMock.create as any).mockResolvedValue({ type: MovementType.RESTOCK, quantity: 20, quantityBefore: 5, quantityAfter: 25 });

      const mov = await service.recordMovement('tenant_001', 'item_001', { type: MovementType.RESTOCK, quantity: 20 });
      expect(mov.quantity).toBe(20);
      expect(StockMock.findOneAndUpdate).toHaveBeenCalledWith(
        expect.not.objectContaining({ currentQuantity: expect.anything() }),
        expect.objectContaining({ $inc: { currentQuantity: 20 } }),
        expect.any(Object),
      );
    });
  });
});
