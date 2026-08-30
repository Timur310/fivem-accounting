import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { factions, factionMembers, users, itemTypes, auditLogs } from '../db/schema.js';
import { eq, ilike, desc, sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router({ mergeParams: true });

// All routes require superadmin
// NOTE: auth is applied per-route, not via router.use(). This router is mounted
// at /api/v1/factions, which prefix-matches the nested faction-scoped routers
// (/factions/:id/entries etc.); router-level middleware would run for those too.

// ── Validation schemas ────────────────────────────────

const createFactionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  initialAdminDiscordId: z.string().min(1),
});

const updateFactionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  payoutApprovalRequired: z.boolean().optional(),
  customFields: z.array(z.object({
    name: z.string().min(1).max(100),
    required: z.boolean(),
  })).optional(),
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

// ── POST / — create faction ─────────────────────────
router.post('/', requireAuth, requireSuperadmin, async (req: Request, res: Response) => {
  const parsed = createFactionSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { name, description, initialAdminDiscordId } = parsed.data;

  // Check for duplicate name
  const [existing] = await db
    .select({ id: factions.id })
    .from(factions)
    .where(eq(factions.name, name))
    .limit(1);
  if (existing) {
    error(res, 'CONFLICT', 'A faction with this name already exists', 409);
    return;
  }

  // Find initial admin by Discord ID
  const [adminUser] = await db
    .select()
    .from(users)
    .where(eq(users.discordId, initialAdminDiscordId))
    .limit(1);
  if (!adminUser) {
    error(res, 'NOT_FOUND', `No user found with Discord ID: ${initialAdminDiscordId}. They must log in first.`);
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Create faction
      const [faction] = await tx
        .insert(factions)
        .values({ name, description: description ?? null, createdBy: req.user!.id })
        .returning();
      if (!faction) throw new Error('Failed to create faction');

      // Add initial admin
      await tx.insert(factionMembers).values({
        factionId: faction.id,
        userId: adminUser.id,
        role: 'admin',
      });

      // Seed default item types
      await tx.insert(itemTypes).values([
        { factionId: faction.id, name: 'Dirty Money', unit: '$' },
        { factionId: faction.id, name: 'Clean Money', unit: '$' },
      ]);

      // Promote user to faction_admin if not superadmin
      if (adminUser.role !== 'superadmin') {
        await tx
          .update(users)
          .set({ role: 'faction_admin' })
          .where(eq(users.id, adminUser.id));
      }

      // Audit log
      await tx.insert(auditLogs).values({
        userId: req.user!.id,
        factionId: faction.id,
        action: 'create',
        entityType: 'faction',
        entityId: faction.id,
        details: { name, description, initialAdminDiscordId: adminUser.discordId },
        ipAddress: req.ip ?? null,
      });

      return faction;
    });

    success(res, result, 201);
  } catch (err: any) {
    if (err?.code === '23505') {
      error(res, 'CONFLICT', 'A faction with this name already exists', 409);
      return;
    }
    console.error('[CREATE FACTION ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to create faction', 500);
  }
});

// ── GET / — list all factions ────────────────────────
router.get('/', requireAuth, requireSuperadmin, async (req: Request, res: Response) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { search, page: pageStr, page_size: pageSizeStr } = query.data;
  const { page, pageSize, offset } = parsePagination({ page: pageStr, page_size: pageSizeStr });

  const whereClause = search ? ilike(factions.name, `%${search}%`) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: factions.id,
        name: factions.name,
        description: factions.description,
        isActive: factions.isActive,
        createdAt: factions.createdAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM faction_members WHERE faction_id = factions.id)::int`,
        entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE faction_id = factions.id AND is_deleted = false)::int`,
      })
      .from(factions)
      .where(whereClause)
      .orderBy(desc(factions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(factions)
      .where(whereClause),
  ]);

  const totalCount = countResult[0]?.count ?? 0;
  success(res, items, 200, { page, page_size: pageSize, total_count: totalCount });
});

// ── GET /:id — faction detail ─────────────────────────
router.get('/:id', requireAuth, requireSuperadmin, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [faction] = await db.select().from(factions).where(eq(factions.id, id)).limit(1);
  if (!faction) {
    error(res, 'NOT_FOUND', 'Faction not found', 404);
    return;
  }

  const members = await db
    .select({
      id: factionMembers.id,
      userId: factionMembers.userId,
      role: factionMembers.role,
      joinedAt: factionMembers.joinedAt,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      discordId: users.discordId,
    })
    .from(factionMembers)
    .innerJoin(users, eq(factionMembers.userId, users.id))
    .where(eq(factionMembers.factionId, id))
    .orderBy(factionMembers.joinedAt);

  const types = await db
    .select()
    .from(itemTypes)
    .where(eq(itemTypes.factionId, id))
    .orderBy(itemTypes.createdAt);

  success(res, { ...faction, members, itemTypes: types });
});

// ── PATCH /:id — update faction ───────────────────────
router.patch('/:id', requireAuth, requireSuperadmin, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const parsed = updateFactionSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db.select().from(factions).where(eq(factions.id, id)).limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Faction not found', 404);
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.brandColor !== undefined) updates.brandColor = parsed.data.brandColor;
  if (parsed.data.payoutApprovalRequired !== undefined) updates.payoutApprovalRequired = parsed.data.payoutApprovalRequired;
  // Ranks, inactivity threshold and strike expiry are faction-run settings and
  // live on PATCH /factions/:id/settings, which faction admins can reach.

  if (parsed.data.customFields !== undefined) {
    const names = parsed.data.customFields.map((f) => f.name);
    if (new Set(names).size !== names.length) {
      error(res, 'VALIDATION_ERROR', 'Custom field names must be unique');
      return;
    }
    updates.customFields = parsed.data.customFields;
  }

  const [updated] = await db
    .update(factions)
    .set(updates)
    .where(eq(factions.id, id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'faction',
    entityId: id,
    details: {
      before: { name: existing.name, description: existing.description, isActive: existing.isActive },
      after: updates,
    },
    req,
  });

  success(res, updated);
});

// ── DELETE /:id — soft-delete faction ─────────────────
router.delete('/:id', requireAuth, requireSuperadmin, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [existing] = await db.select().from(factions).where(eq(factions.id, id)).limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Faction not found', 404);
    return;
  }

  await db.update(factions).set({ isActive: false }).where(eq(factions.id, id));

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'delete',
    entityType: 'faction',
    entityId: id,
    details: { name: existing.name },
    req,
  });

  success(res, { id, deleted: true });
});

export default router;
