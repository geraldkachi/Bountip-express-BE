# Bountip – Express Implementation

> **Stack:** Express · Mongoose · MongoDB · TypeScript · Jest

---

## Quick start

```bash
# 1. Start MongoDB
mongod --dbpath /data/db
# or: docker run -d -p 27017:27017 mongo:7

# 2. Configure
cp .env.example .env   # set MONGODB_URI, PORT=3001

# 3. Run
npm install
npm run dev

# API: http://localhost:3001/api
```

## Tests

```bash
npm test    # 19 unit tests
```

**Coverage:**
- `sync/__tests__/sync.service.spec.ts`           — 4 tests: clean sync, sort order, conflict merge, idempotency
- `inventory/__tests__/inventory.service.spec.ts` — 3 tests: tenant isolation, SALE atomicity, RESTOCK
- `payments/__tests__/payments.service.spec.ts`   — 10 tests: success+events, idempotency, 3 failure modes, 5 reconcile cases

## Architecture

Plain Express — no IoC container. Each feature is a self-contained folder:

```
src/
  sync/
    sync.model.ts     ← mongoose.model() with indexes
    sync.service.ts   ← class with business logic, calls model directly
    sync.routes.ts    ← Express Router, instantiates service, delegates
  inventory/          ← same structure
  payments/           ← same structure
  common/
    logger.ts         ← requestLogger middleware + errorHandler
  db/
    connection.ts     ← connectDB(uri)
  app.ts              ← express(), mounts routers, starts server
```

Services are plain classes — `new SyncService()` in the route file. This keeps
the Express version framework-free in the business layer, so the service tests
are simple unit tests with `jest.mock()` on the model module.

## Endpoints

Same contract as the NestJS version — all routes are under `/api/`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sync/batch` | Submit offline operation batch |
| GET  | `/api/sync/operations?tenantId=` | Server operation log |
| POST | `/api/inventory/tenants` | Register location |
| GET  | `/api/inventory/tenants` | List tenants |
| POST | `/api/inventory/tenants/:id/items` | Create stock item |
| PATCH | `/api/inventory/tenants/:tid/items/:iid` | Update item |
| GET  | `/api/inventory/tenants/:id/items` | Stock levels |
| GET  | `/api/inventory/tenants/:id/items/low-stock` | Below threshold |
| POST | `/api/inventory/tenants/:tid/items/:iid/movements` | Record movement |
| GET  | `/api/inventory/tenants/:tid/items/:iid/movements` | Movement history |
| GET  | `/api/inventory/aggregate/:parentId` | Aggregate across locations |
| POST | `/api/payments/initiate?scenario=` | Idempotent charge |
| GET  | `/api/payments/:tenantId` | Payment list |
| GET  | `/api/payments/:tid/:pid/events` | Audit log |
| POST | `/api/payments/:tenantId/reconcile` | Reconciliation |

## Express — key differences

| Concern | Express |
|---|---|---|
| DI / wiring | IoC container, `@Injectable()` | `new Service()` in route file |
| Model access | `@InjectModel(X.name)` | Direct `mongoose.model()` import |
| Validation | `class-validator` + `ValidationPipe` | Manual or middleware |
| Testing | `getModelToken()` + `TestingModule` | `jest.mock('../model')` |
| Docs | `@nestjs/swagger` decorators | Manual OpenAPI YAML |
| Middleware | `configure(consumer)` in AppModule | `app.use()` |
| Error handling | Exception filters | `errorHandler` middleware |
| Business logic | Identical | Identical |



Assumptions & Tradeoffs

No auth middleware — the assessment focuses on backend logic; authentication is omitted intentionally
Mock payment provider — no live API keys needed; the provider is a local stub with configurable failure scenarios
LWW over CRDT — simpler and appropriate for a prototype; a production sync engine would benefit from a proper CRDT for inventory counters
Manual validation — no validation library (like Zod or class-validator) is added to keep the surface area focused on the three core tasks


One Thing I'd Improve

The sync engine's conflict detection is per-item and stateless — it only looks at the current batch in isolation. Given more time, I'd build a proper vector clock per inventory item so the server can track causality across multiple clients and multiple batches, not just detect conflicts at submission time. This would make the system correct under partition scenarios rather than just tolerant of them.