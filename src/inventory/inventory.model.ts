import mongoose, { Schema, Document } from 'mongoose';

// ─── Tenant ───────────────────────────────────────────────────────────────────
export interface ITenant extends Document {
  slug: string; name: string; parentId: string | null;
  createdAt: Date; updatedAt: Date;
}
const tenantSchema = new Schema<ITenant>(
  { slug: { type: String, required: true, unique: true }, name: { type: String, required: true }, parentId: { type: String, default: null } },
  { collection: 'tenants', timestamps: true },
);
export const TenantModel = mongoose.model<ITenant>('Tenant', tenantSchema);

// ─── StockItem ────────────────────────────────────────────────────────────────
export interface IStockItem extends Document {
  tenantId: string; sku: string; name: string; category: string | null;
  currentQuantity: number; lowStockThreshold: number; unit: string; costPerUnit: number;
  createdAt: Date; updatedAt: Date;
}
const stockItemSchema = new Schema<IStockItem>(
  {
    tenantId:          { type: String, required: true, index: true },
    sku:               { type: String, required: true },
    name:              { type: String, required: true },
    category:          { type: String, default: null },
    currentQuantity:   { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 0 },
    unit:              { type: String, default: 'unit' },
    costPerUnit:       { type: Number, default: 0 },
  },
  { collection: 'stock_items', timestamps: true },
);
stockItemSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
stockItemSchema.index({ tenantId: 1, currentQuantity: 1 });
export const StockItemModel = mongoose.model<IStockItem>('StockItem', stockItemSchema);

// ─── StockMovement ────────────────────────────────────────────────────────────
export enum MovementType { SALE = 'SALE', RESTOCK = 'RESTOCK', WASTE = 'WASTE', ADJUSTMENT = 'ADJUSTMENT' }

export interface IStockMovement extends Document {
  tenantId: string; stockItemId: string; type: MovementType;
  quantity: number; quantityBefore: number; quantityAfter: number;
  referenceId: string | null; notes: string | null; performedBy: string | null;
  createdAt: Date;
}
const movementSchema = new Schema<IStockMovement>(
  {
    tenantId:       { type: String, required: true, index: true },
    stockItemId:    { type: String, required: true, index: true },
    type:           { type: String, enum: Object.values(MovementType), required: true },
    quantity:       { type: Number, required: true },
    quantityBefore: { type: Number, required: true },
    quantityAfter:  { type: Number, required: true },
    referenceId:    { type: String, default: null },
    notes:          { type: String, default: null },
    performedBy:    { type: String, default: null },
  },
  { collection: 'stock_movements', timestamps: { createdAt: true, updatedAt: false } },
);
movementSchema.index({ tenantId: 1, createdAt: -1 });
movementSchema.index({ stockItemId: 1, createdAt: -1 });
export const StockMovementModel = mongoose.model<IStockMovement>('StockMovement', movementSchema);
