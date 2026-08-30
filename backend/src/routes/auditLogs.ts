import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { auditLogs, users } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { buildWhere } from '../lib/query.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireFactionAdminOrSuperadmin);

const listAuditQuerySchema = z.object({
  action: z.string().optional(),
  entity_type: z.string().optional(),
  user_id: z.string().uuid().optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const query = listAuditQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { action, entity_type, user_id, page: pageStr, page_size: pageSizeStr } = query.data;
  const { page, pageSize, offset } = parsePagination({ page: pageStr, page_size: pageSizeStr });

  const where = buildWhere([
    eq(auditLogs.factionId, factionId),
    action ? eq(auditLogs.action, action) : undefined,
    entity_type ? eq(auditLogs.entityType, entity_type) : undefined,
    user_id ? eq(auditLogs.userId, user_id) : undefined,
  ]);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        actorUsername: users.username,
        actorInGameName: users.inGameName,
        actorDiscordId: users.discordId,
      })
      .from(auditLogs)
      .innerJoin(users, eq(auditLogs.userId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(auditLogs)
      .where(where),
  ]);

  const totalCount = countResult[0]?.count ?? 0;
  success(res, items, 200, { page, page_size: pageSize, total_count: totalCount });
});

export default router;
