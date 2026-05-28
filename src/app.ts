import 'dotenv/config';
import express from 'express';
import { connectDB } from './db/connection'; 
import { requestLogger, errorHandler } from './common/logger';
import syncRoutes      from './sync/sync.routes';
import inventoryRoutes from './inventory/inventory.routes';
import paymentsRoutes  from './payments/payments.routes';

export const app = express();

app.use(express.json());
app.use(requestLogger);

app.use('/api/sync',      syncRoutes); 
app.use('/api/inventory', inventoryRoutes);
app.use('/api/payments',  paymentsRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use(errorHandler);

if (require.main === module) {
  const uri  = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/bountip';
  const port = process.env.PORT ?? 3001;

  connectDB(uri).then(() => {
    app.listen(port, () => {
      console.log(`🚀  http://localhost:${port}`); 
    });
  });
}
