import { Response } from 'express';
import type { ApiSuccessResponse, ApiErrorResponse } from './types.js';

export function success(
  res: Response,
  data: unknown,
  status = 200,
  meta?: ApiSuccessResponse<unknown>['meta'],
): Response {
  const body: ApiSuccessResponse<unknown> = { data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function error(res: Response, code: string, message: string, status = 400): Response {
  const body: ApiErrorResponse = { error: { code, message } };
  return res.status(status).json(body);
}
