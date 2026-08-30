import { db, type TransactionLike } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import type { Request } from 'express';
import type { NewAuditLog } from '../db/schema.js';

/**
 * Write an audit log entry.
 *
 * `tx` is optional so the log can participate in the caller's transaction —
 * if the surrounding mutation rolls back, the audit entry rolls back too,
 * which keeps the log from claiming an action happened that did not.
 */
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
  const conn = tx ?? db;

  const logEntry: NewAuditLog = {
    userId,
    factionId: factionId ?? null,
    action,
    entityType,
    entityId: entityId ?? null,
    details: details ?? null,
    ipAddress: req?.ip ?? null,
  };

  await conn.insert(auditLogs).values(logEntry);
}
