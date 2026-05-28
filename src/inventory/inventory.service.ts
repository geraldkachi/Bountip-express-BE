import createError from 'http-errors';
import { TenantModel, StockItemModel, StockMovementModel, MovementType } from './inventory.model';

export class InventoryService {

  // ─── Tenants ──────────────────────────────────────────────────────────────

  createTenant(data: { slug: string; name: string; parentId?: string }) {
    return TenantModel.create(data);
  }

  getTenants() { return TenantModel.find().sort({ name: 1 }); }

  // ─── Stock Items ──────────────────────────────────────────────────────────

  async createStockItem(tenantId: string, data: any) {
    await this.assertTenant(tenantId);
    return StockItemModel.create({ ...data, tenantId });
  }

  async updateStockItem(tenantId: string, itemId: string, data: any) {
    const item = await StockItemModel.findOneAndUpdate(
      { _id: itemId, tenantId }, { $set: data }, { new: true },
    );
    if (!item) throw createError(404, `Item ${itemId} not found for tenant ${tenantId}`);
    return item;
  }

  async getStockLevels(tenantId: string) {
    await this.assertTenant(tenantId);
    return StockItemModel.find({ tenantId }).sort({ name: 1 });
  }

  async getAggregateStockLevels(parentTenantId: string) {
    const children = await TenantModel.find({ parentId: parentTenantId });
    const ids = [parentTenantId, ...children.map(t => String(t._id))];

    const aggregates = await StockItemModel.aggregate([
      { $match: { tenantId: { $in: ids } } },
      {
        $group: {
          _id: { sku: '$sku', name: '$name', category: '$category' },
          totalQuantity: { $sum: '$currentQuantity' },
          locationCount: { $addToSet: '$tenantId' },
          minQuantity:   { $min: '$currentQuantity' },
        },
      },
      {
        $project: {
          _id: 0, sku: '$_id.sku', name: '$_id.name', category: '$_id.category',
          totalQuantity: 1, minQuantity: 1, locationCount: { $size: '$locationCount' },
        },
      },
      { $sort: { name: 1 } },
    ]);

    return { parentTenantId, childCount: children.length, aggregates };
  }

  // ─── Movements ────────────────────────────────────────────────────────────

  async recordMovement(tenantId: string, itemId: string, data: {
    type: MovementType; quantity: number;
    referenceId?: string; notes?: string; performedBy?: string;
  }) {
    const delta  = this.delta(data.type, data.quantity);
    const before = await StockItemModel.findOne({ _id: itemId, tenantId });
    if (!before) throw createError(404, `Item ${itemId} not found for tenant ${tenantId}`);

    const filter: Record<string, any> = { _id: itemId, tenantId };
    if (delta < 0) filter.currentQuantity = { $gte: Math.abs(delta) };

    const updated = await StockItemModel.findOneAndUpdate(
      filter, { $inc: { currentQuantity: delta } }, { new: true },
    );
    if (!updated) throw createError(400, `Insufficient stock. Current: ${before.currentQuantity}, Requested: ${data.quantity}`);

    const movement = await StockMovementModel.create({
      tenantId, stockItemId: itemId, type: data.type, quantity: delta,
      quantityBefore: before.currentQuantity, quantityAfter: updated.currentQuantity,
      referenceId: data.referenceId ?? null, notes: data.notes ?? null,
      performedBy: data.performedBy ?? null,
    });

    console.log(JSON.stringify({
      event: 'stock_movement', tenantId, itemId,
      movementType: data.type, delta,
      quantityBefore: before.currentQuantity, quantityAfter: updated.currentQuantity,
    }));

    if (updated.currentQuantity <= updated.lowStockThreshold && updated.lowStockThreshold > 0) {
      console.warn(JSON.stringify({
        event: 'low_stock_alert', tenantId, itemId,
        sku: updated.sku, currentQuantity: updated.currentQuantity,
        threshold: updated.lowStockThreshold,
      }));
    }

    return movement;
  }

  async getMovementHistory(tenantId: string, itemId: string) {
    const item = await StockItemModel.findOne({ _id: itemId, tenantId });
    if (!item) throw createError(404, `Item ${itemId} not found`);
    const movements = await StockMovementModel
      .find({ tenantId, stockItemId: itemId })
      .sort({ createdAt: -1 }).limit(50);
    return { item, movements };
  }

  getLowStockItems(tenantId: string) {
    return StockItemModel.aggregate([
      { $match: { tenantId, lowStockThreshold: { $gt: 0 } } },
      { $match: { $expr: { $lte: ['$currentQuantity', '$lowStockThreshold'] } } },
      { $sort: { currentQuantity: 1 } },
    ]);
  }

  private delta(type: MovementType, qty: number) {
    return type === MovementType.SALE || type === MovementType.WASTE ? -Math.abs(qty) : Math.abs(qty);
  }

  private async assertTenant(tenantId: string) {
    const exists = await TenantModel.findById(tenantId);
    if (!exists) throw createError(404, `Tenant ${tenantId} not found`);
  }
}
