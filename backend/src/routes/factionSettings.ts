import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { factions, factionMembers, DEFAULT_STRIKE_EXPIRY_DAYS, FACTION_PERMISSIONS } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router({ mergeParams: true });

// Operational settings a faction runs itself: ranks and the discipline knobs.
// Deliberately separate from PATCH /factions/:id, which is superadmin-only and
// governs the faction's existence (name, active flag) rather than how it is run.
router.use(requireAuth, requireFactionMember);

const updateSettingsSchema = z.object({
  ranks: z.array(z.object({
    name: z.string().min(1).max(100),
    level: z.number().int().min(1).max(100),
    permissions: z.array(z.enum(FACTION_PERMISSIONS)).default([]),
  })).max(20).optional(),
  inactivityThresholdDays: z.number().int().min(1).max(365).optional(),
  strikeExpiryDays: z.object({
    warning: z.number().int().min(1).max(3650).nullable(),
    minor: z.number().int().min(1).max(3650).nullable(),
    major: z.number().int().min(1).max(3650).nullable(),
  }).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  customFields: z.array(z.object({
    name: z.string().min(1).max(100),
    required: z.boolean(),
  })).optional(),
}).refine(
  (d) => Object.keys(d).length > 0,
  'Provide at least one setting to update',
);

// ── GET / — read current settings ────────────────────
// Readable by any member: ranks show up on the roster, and the inactivity
// threshold explains why someone is flagged.
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const [faction] = await db
    .select({
      ranks: factions.ranks,
      inactivityThresholdDays: factions.inactivityThresholdDays,
      strikeExpiryDays: factions.strikeExpiryDays,
      brandColor: factions.brandColor,
      customFields: factions.customFields,
    })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);

  if (!faction) {
    error(res, 'NOT_FOUND', 'Faction not found', 404);
    return;
  }

  success(res, {
    ranks: faction.ranks ?? [],
    inactivityThresholdDays: faction.inactivityThresholdDays,
    // Surface the effective values so the UI never has to know the defaults.
    strikeExpiryDays: faction.strikeExpiryDays ?? DEFAULT_STRIKE_EXPIRY_DAYS,
    brandColor: faction.brandColor,
    customFields: faction.customFields ?? [],
  });
});

// ── PATCH / — update settings ────────────────────────
// Either manage_settings OR manage_customization grants write access: a
// faction admin who can only tweak branding should not be blocked by not
// having manage_settings, and vice versa.
router.patch(
  '/',
  (req, res, next) => {
    const perms = req.factionPermissions ?? [];
    if (perms.includes('manage_settings') || perms.includes('manage_customization')) {
      next();
      return;
    }
    requirePermission('manage_settings')(req, res, next);
  },
  async (req: Request, res: Response) => {
    const factionId = req.params.id as string;

    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
      return;
    }

    const [existing] = await db
      .select({
        ranks: factions.ranks,
        inactivityThresholdDays: factions.inactivityThresholdDays,
        strikeExpiryDays: factions.strikeExpiryDays,
        brandColor: factions.brandColor,
        customFields: factions.customFields,
      })
      .from(factions)
      .where(eq(factions.id, factionId))
      .limit(1);
    if (!existing) {
      error(res, 'NOT_FOUND', 'Faction not found', 404);
      return;
    }

    const updates: Record<string, unknown> = {};
    let removedRanks: string[] = [];

    if (parsed.data.ranks !== undefined) {
      const names = parsed.data.ranks.map((r) => r.name);
      if (new Set(names).size !== names.length) {
        error(res, 'VALIDATION_ERROR', 'Rank names must be unique');
        return;
      }
      const levels = parsed.data.ranks.map((r) => r.level);
      if (new Set(levels).size !== levels.length) {
        error(res, 'VALIDATION_ERROR', 'Rank levels must be unique');
        return;
      }

      // Who holds which permission is an admin decision. Without this, anyone
      // granted manage_settings — or manage_customization, which sounds purely
      // cosmetic — could rewrite their own rank's permission list and hand
      // themselves every permission there is. Renaming and re-levelling ranks
      // stays delegable; only the permission arrays are locked down.
      // A global superadmin counts as an admin here even in a faction they
      // joined as a plain member — `factionRole` follows the membership, which
      // is what entry creation needs, but it is not the whole authority story.
      const isAdmin =
        req.factionRole === 'admin' ||
        req.factionRole === 'superadmin' ||
        req.user!.role === 'superadmin';
      if (!isAdmin) {
        const before = new Map(
          (existing.ranks ?? []).map((r) => [r.name, [...(r.permissions ?? [])].sort()]),
        );
        const changed = parsed.data.ranks.some((r) => {
          const previous = before.get(r.name);
          const next = [...r.permissions].sort();
          // A rank that did not exist before may only be created without
          // permissions; an existing one must keep exactly what it had.
          if (previous === undefined) return next.length > 0;
          return previous.length !== next.length || previous.some((p, i) => p !== next[i]);
        });
        if (changed) {
          error(res, 'FORBIDDEN', 'Only a faction admin can change rank permissions', 403);
          return;
        }
      }

      removedRanks = (existing.ranks ?? []).map((r) => r.name).filter((n) => !names.includes(n));
      updates.ranks = parsed.data.ranks;
    }

    if (parsed.data.inactivityThresholdDays !== undefined) {
      updates.inactivityThresholdDays = parsed.data.inactivityThresholdDays;
    }
    if (parsed.data.strikeExpiryDays !== undefined) {
      updates.strikeExpiryDays = parsed.data.strikeExpiryDays;
    }
    if (parsed.data.brandColor !== undefined) updates.brandColor = parsed.data.brandColor;
    if (parsed.data.customFields !== undefined) {
      const names = parsed.data.customFields.map((f) => f.name);
      if (new Set(names).size !== names.length) {
        error(res, 'VALIDATION_ERROR', 'Custom field names must be unique');
        return;
      }
      updates.customFields = parsed.data.customFields;
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(factions)
        .set(updates)
        .where(eq(factions.id, factionId))
        .returning({
          ranks: factions.ranks,
          inactivityThresholdDays: factions.inactivityThresholdDays,
          strikeExpiryDays: factions.strikeExpiryDays,
          brandColor: factions.brandColor,
          customFields: factions.customFields,
        });

      // Clearing removed ranks off members happens in the same transaction as
      // the rank list itself, so the roster can never show a rank that no
      // longer exists.
      if (removedRanks.length > 0) {
        await tx
          .update(factionMembers)
          .set({ rank: null })
          .where(
            and(
              eq(factionMembers.factionId, factionId),
              inArray(factionMembers.rank, removedRanks),
            ),
          );
      }

      return row;
    });

    await createAuditLog({
      userId: req.user!.id,
      factionId,
      action: 'update',
      entityType: 'faction_settings',
      entityId: factionId,
      details: {
        before: {
          ranks: existing.ranks,
          inactivityThresholdDays: existing.inactivityThresholdDays,
          strikeExpiryDays: existing.strikeExpiryDays,
          brandColor: existing.brandColor,
          customFields: existing.customFields,
        },
        after: updates,
        ...(removedRanks.length > 0 ? { removedRanks } : {}),
      },
      req,
    });

    success(res, {
      ranks: updated?.ranks ?? [],
      inactivityThresholdDays: updated?.inactivityThresholdDays,
      strikeExpiryDays: updated?.strikeExpiryDays ?? DEFAULT_STRIKE_EXPIRY_DAYS,
      brandColor: updated?.brandColor ?? null,
      customFields: updated?.customFields ?? [],
      ...(removedRanks.length > 0 ? { clearedFromMembers: removedRanks } : {}),
    });
  },
);

export default router;
