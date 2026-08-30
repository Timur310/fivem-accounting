import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { error } from '../lib/response.js';
import { env } from '../lib/env.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
      : 'Validation failed';
    error(res, 'VALIDATION_ERROR', message, 400);
    return;
  }

  // Our custom app errors (shape: { code, message, status })
  if (err && typeof err === 'object' && 'code' in err) {
    const appErr = err as { code: string; message: string; status?: number };
    error(res, appErr.code, appErr.message, appErr.status ?? 400);
    return;
  }

  // Unexpected errors
  console.error('[ERROR]', err);
  error(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
