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
    // Don't leak stack details even for app errors in production.
    if (env.NODE_ENV === 'production') {
      console.log(JSON.stringify({ level: 'error', msg: appErr.message, code: appErr.code }));
    } else {
      console.error('[ERROR]', err);
    }
    error(res, appErr.code, appErr.message, appErr.status ?? 400);
    return;
  }

  // Unexpected errors
  if (env.NODE_ENV === 'production') {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err && typeof err === 'object' && 'code' in err)
      ? String((err as { code?: unknown }).code)
      : 'INTERNAL_ERROR';
    // In production, log a single structured line — no stack traces.
    console.log(JSON.stringify({ level: 'error', msg, code }));
  } else {
    console.error('[ERROR]', err);
  }
  error(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
