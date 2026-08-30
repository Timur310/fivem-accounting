import { db, type TransactionLike } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import type { Request } from 'express';
import type { NewAuditLog } from '../db/schema.js';

export async function createAuditLog(params: {
  userId: string;
  factionId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  req?: Request;
  tx?: TransactionLike;
}): Promise<void> {
  const { userId, factionId, action, entityType, entityId, details, req, tx } = params;

  const logEntry: NewAuditLog = {
    userId,
    factionId: factionId ?? null,
    action,
    entityType,
    entityId: entityId ?? null,
    details: details ?? null,
    ipAddress: req?.ip ?? null,
  };

  const conn = tx ?? db;
  await conn.insert(auditLogs).values(logEntry);
}
