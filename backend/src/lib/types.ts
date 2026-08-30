import { Request } from 'express';
import type { User } from '../db/schema.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      factionRole?: 'superadmin' | 'admin' | 'member';
      /** Permissions granted by the user's rank within this faction.
       *  Always the full list for admins/superadmins. */
      factionPermissions?: string[];
    }
  }
}

export interface JwtPayload {
  userId: string;
  role: string;
}

export interface PaginationQuery {
  page?: string;
  page_size?: string;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    page: number;
    page_size: number;
    total_count: number;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export function parsePagination(query: PaginationQuery) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
