import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { error } from '../lib/response.js';
import { env } from '../lib/env.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
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
    // In production, log only the structured bits. Stacks belong in dev.
    if (env.NODE_ENV === 'production') {
      console.log(JSON.stringify({ level: 'error', msg: appErr.message, code: appErr.code }));
    } else {
      console.error('[ERROR]', appErr);
    }
    error(res, appErr.code, appErr.message, appErr.status ?? 400);
    return;
  }

  // Unexpected errors
  if (env.NODE_ENV === 'production') {
    console.log(JSON.stringify({ level: 'error', msg: 'Unexpected error', code: 'INTERNAL_ERROR' }));
  } else {
    console.error('[ERROR]', err);
  }
  error(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
