import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = uuidv4();
  const tenantId  = (req.headers['x-tenant-id'] as string) ?? 'unknown';
  const start     = Date.now();
  (req as any).requestId = requestId;
  res.on('finish', () => {
    console.log(JSON.stringify({
      requestId, tenantId,
      method: req.method, path: req.path,
      statusCode: res.statusCode,
      latencyMs: Date.now() - start,
      outcome: res.statusCode < 400 ? 'success' : 'error',
      timestamp: new Date().toISOString(),
    }));
  });
  next();
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status  = err.status ?? err.statusCode ?? 500;
  const message = err.message ?? 'Internal server error';
  console.error(JSON.stringify({ error: message, stack: err.stack }));
  res.status(status).json({ statusCode: status, message });
}
