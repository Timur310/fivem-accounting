import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, type TransactionLike } from '../db/index.js';
import {
  itemTypes,
  quotas,
  factions,
  factionMembers,
  users,
  FACTION_PERMISSIONS,
} from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { todayDateString } from '../lib/date.js';
import { parseCSVLine } from './bulk.js';

/** One entry of factions.ranks (jsonb) — display-only rank with permissions. */
interface RankDef {
  name: string;
  level: number;
  permissions: string[];
}

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Shared helpers ────────────────────────────────────

const MAX_CSV_BYTES = 500_000;
const MAX_CSV_ROWS = 1000;

function setCsvHeaders(res: Response, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

function csvEscape(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const csvBodySchema = z.object({
  csv: z.string().min(5).max(MAX_CSV_BYTES),
});

/** Split the uploaded text into header + data rows, enforcing the row cap. */
function parseCsvRows(
  csv: string,
): { header: string[]; rows: string[][] } | { error: string } {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { error: 'CSV must have a header row and at least one data row' };
  }
  if (lines.length - 1 > MAX_CSV_ROWS) {
    return { error: `CSV exceeds the ${MAX_CSV_ROWS}-row limit (got ${lines.length - 1})` };
  }
  return {
    header: parseCSVLine(lines[0] ?? '').map((h) => h.trim().toLowerCase()),
    rows: lines.slice(1).map((l) => parseCSVLine(l)),
  };
}

function columnIndex(header: string[], ...names: string[]): number {
  return header.findIndex((h) => names.includes(h));
}

function parseBool(value: string | undefined, fallback: boolean): boolean | null {
  if (value === undefined || value.trim() === '') return fallback;
  const v = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'igen'].includes(v)) return true;
  if (['false', 'no', '0', 'nem'].includes(v)) return false;
  return null;
}

async function loadFaction(factionId: string) {
  const [faction] = await db
    .select()
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);
  return faction && faction.isActive ? faction : null;
}

// ── GET /item-types — CSV export ─────────────────────
router.get('/item-types', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const rows = await db
    .select()
    .from(itemTypes)
    .where(eq(itemTypes.factionId, factionId));

  setCsvHeaders(res, `item-types-${factionId.slice(0, 8)}-${todayDateString()}.csv`);
  res.write('Name,Unit,Is Currency,Active\n');
  for (const r of rows) {
    res.write(
      `${csvEscape(r.name)},${csvEscape(r.unit)},${r.isCurrency},${r.isActive}\n`,
    );
  }
  res.end();
});

// ── GET /quotas — CSV export ─────────────────────────
router.get('/quotas', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const rows = await db
    .select({
      itemTypeName: itemTypes.name,
      targetAmount: quotas.targetAmount,
      periodType: quotas.periodType,
      periodStart: quotas.periodStart,
      targetUsername: users.username,
      isActive: quotas.isActive,
    })
    .from(quotas)
    .innerJoin(itemTypes, eq(quotas.itemTypeId, itemTypes.id))
    .leftJoin(users, eq(quotas.targetUserId, users.id))
    .where(eq(quotas.factionId, factionId));

  setCsvHeaders(res, `quotas-${factionId.slice(0, 8)}-${todayDateString()}.csv`);
  res.write('Item Type,Target Amount,Period Type,Period Start,Target Member,Active\n');
  for (const r of rows) {
    res.write(
      `${csvEscape(r.itemTypeName)},${r.targetAmount},${r.periodType},${r.periodStart},${csvEscape(r.targetUsername)},${r.isActive}\n`,
    );
  }
  res.end();
});

// ── GET /ranks — CSV export ──────────────────────────
router.get('/ranks', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const [faction] = await db
    .select({ ranks: factions.ranks })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);

  setCsvHeaders(res, `ranks-${factionId.slice(0, 8)}-${todayDateString()}.csv`);
  res.write('Name,Level,Permissions\n');
  for (const r of faction?.ranks ?? []) {
    // Pipe-separated: a permission list is not a sentence, but it is also not
    // something a comma belongs inside.
    res.write(
      `${csvEscape(r.name)},${r.level},${csvEscape((r.permissions ?? []).join('|'))}\n`,
    );
  }
  res.end();
});

// ── POST /item-types — CSV import (upsert by name) ───
router.post('/item-types', requirePermission('manage_item_types'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = csvBodySchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const faction = await loadFaction(factionId);
  if (!faction) {
    error(res, 'NOT_FOUND', 'Faction not found or inactive', 404);
    return;
  }

  const parsedCsv = parseCsvRows(parsed.data.csv);
  if ('error' in parsedCsv) {
    error(res, 'BAD_REQUEST', parsedCsv.error);
    return;
  }
  const { header, rows } = parsedCsv;
  const nameIdx = columnIndex(header, 'name');
  const unitIdx = columnIndex(header, 'unit');
  const currencyIdx = columnIndex(header, 'is currency', 'iscurrency', 'is_currency');
  const activeIdx = columnIndex(header, 'active');
  if (nameIdx === -1) {
    error(res, 'BAD_REQUEST', 'CSV must have a "Name" column');
    return;
  }

  const existing = await db
    .select()
    .from(itemTypes)
    .where(eq(itemTypes.factionId, factionId));
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));

  const result = { imported: 0, updated: 0, skipped: 0, errors: [] as string[] };
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i] ?? [];
    const name = (cols[nameIdx] ?? '').trim();
    if (!name) {
      result.skipped++;
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      result.errors.push(`Row ${i + 2}: duplicate name "${name}"`);
      result.skipped++;
      continue;
    }
    seen.add(key);

    const isCurrency = parseBool(cols[currencyIdx], false);
    if (isCurrency === null) {
      result.errors.push(`Row ${i + 2}: "Is Currency" must be true or false`);
      result.skipped++;
      continue;
    }
    const isActive = parseBool(cols[activeIdx], true);
    if (isActive === null) {
      result.errors.push(`Row ${i + 2}: "Active" must be true or false`);
      result.skipped++;
      continue;
    }
    // Unit is optional; the derived-unit rule fills it in when left out.
    let unit = (cols[unitIdx] ?? '').trim() || (isCurrency ? '$' : 'pcs');
    if (unit.length > 20) {
      result.errors.push(`Row ${i + 2}: unit too long`);
      result.skipped++;
      continue;
    }
    if (name.length > 100) {
      result.errors.push(`Row ${i + 2}: name too long`);
      result.skipped++;
      continue;
    }

    const match = byName.get(key);
    if (match) {
      await db
        .update(itemTypes)
        .set({ unit, isCurrency, isActive })
        .where(eq(itemTypes.id, match.id));
      result.updated++;
    } else {
      await db
        .insert(itemTypes)
        .values({ factionId, name, unit, isCurrency, isActive });
      result.imported++;
    }
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'bulk_create',
    entityType: 'item_type',
    details: { source: 'csv_import', ...result },
    req,
  });

  success(res, result);
});

// ── POST /quotas — CSV import ────────────────────────
router.post('/quotas', requirePermission('manage_quotas'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = csvBodySchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const faction = await loadFaction(factionId);
  if (!faction) {
    error(res, 'NOT_FOUND', 'Faction not found or inactive', 404);
    return;
  }

  const parsedCsv = parseCsvRows(parsed.data.csv);
  if ('error' in parsedCsv) {
    error(res, 'BAD_REQUEST', parsedCsv.error);
    return;
  }
  const { header, rows } = parsedCsv;
  const itemIdx = columnIndex(header, 'item type', 'item_type', 'itemtype');
  const targetIdx = columnIndex(header, 'target amount', 'target_amount', 'target');
  const periodIdx = columnIndex(header, 'period type', 'period_type');
  const startIdx = columnIndex(header, 'period start', 'period_start');
  const memberIdx = columnIndex(header, 'target member', 'target_member', 'member');
  const activeIdx = columnIndex(header, 'active');
  if (itemIdx === -1 || targetIdx === -1) {
    error(res, 'BAD_REQUEST', 'CSV must have "Item Type" and "Target Amount" columns');
    return;
  }

  const [types, memberRows, existingQuotas] = await Promise.all([
    db.select().from(itemTypes).where(eq(itemTypes.factionId, factionId)),
    db
      .select({ userId: users.id, username: users.username, inGameName: users.inGameName })
      .from(factionMembers)
      .innerJoin(users, eq(factionMembers.userId, users.id))
      .where(eq(factionMembers.factionId, factionId)),
    db.select().from(quotas).where(eq(quotas.factionId, factionId)),
  ]);
  const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));
  const memberByName = new Map<string, string>();
  for (const m of memberRows) {
    if (m.username) memberByName.set(m.username.toLowerCase(), m.userId);
    if (m.inGameName) memberByName.set(m.inGameName.toLowerCase(), m.userId);
  }

  const result = { imported: 0, skipped: 0, errors: [] as string[] };
  const importedActiveKeys: string[] = [];
  const quotaKey = (itemTypeId: string, periodType: string, targetUserId: string | null) =>
    `${itemTypeId}:${periodType}:${targetUserId ?? 'faction'}`;

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i] ?? [];
    const rowNo = i + 2;

    const itemTypeName = (cols[itemIdx] ?? '').trim().toLowerCase();
    const itemType = typeByName.get(itemTypeName);
    if (!itemType) {
      result.errors.push(`Row ${rowNo}: unknown item type "${itemTypeName}"`);
      result.skipped++;
      continue;
    }

    const amountRaw = (cols[targetIdx] ?? '').trim().replace(/[^0-9.]/g, '');
    const amount = Number(amountRaw);
    if (!amountRaw || isNaN(amount) || amount <= 0) {
      result.errors.push(`Row ${rowNo}: invalid target amount "${amountRaw}"`);
      result.skipped++;
      continue;
    }

    const periodType = ((cols[periodIdx] ?? 'monthly').trim().toLowerCase());
    if (periodType !== 'weekly' && periodType !== 'monthly') {
      result.errors.push(`Row ${rowNo}: period type must be weekly or monthly`);
      result.skipped++;
      continue;
    }

    const periodStart = (cols[startIdx] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
      result.errors.push(`Row ${rowNo}: period start must be YYYY-MM-DD`);
      result.skipped++;
      continue;
    }

    const isActive = parseBool(cols[activeIdx], true);
    if (isActive === null) {
      result.errors.push(`Row ${rowNo}: "Active" must be true or false`);
      result.skipped++;
      continue;
    }

    // Blank target = faction-wide. A name must match a current member by
    // Discord name or in-game name, or the row is skipped — the same rule
    // entry imports follow.
    const memberName = memberIdx >= 0 ? (cols[memberIdx] ?? '').trim() : '';
    let targetUserId: string | null = null;
    if (memberName) {
      targetUserId = memberByName.get(memberName.toLowerCase()) ?? null;
      if (!targetUserId) {
        result.errors.push(`Row ${rowNo}: "${memberName}" is not a faction member`);
        result.skipped++;
        continue;
      }
    }

    // One active quota per (item type + period + scope) — mirror of the
    // create endpoint's duplicate guard. The existing rows and whatever this
    // import has already inserted both count.
    const duplicate =
      existingQuotas.some(
        (q) =>
          q.isActive &&
          q.itemTypeId === itemType.id &&
          q.periodType === periodType &&
          (q.targetUserId ?? null) === targetUserId,
      ) ||
      importedActiveKeys.includes(quotaKey(itemType.id, periodType, targetUserId));
    if (duplicate && isActive) {
      result.errors.push(`Row ${rowNo}: an active quota already exists for this item type and period`);
      result.skipped++;
      continue;
    }

    await db.insert(quotas).values({
      factionId,
      itemTypeId: itemType.id,
      targetAmount: amountRaw,
      periodType,
      periodStart,
      targetUserId,
      isActive,
    });
    if (isActive) {
      // Track what this import itself created so two rows in one file cannot
      // both pass the duplicate guard.
      importedActiveKeys.push(quotaKey(itemType.id, periodType, targetUserId));
    }
    result.imported++;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'bulk_create',
    entityType: 'quota',
    details: { source: 'csv_import', ...result },
    req,
  });

  success(res, result);
});

// ── POST /ranks — CSV import (full replace) ──────────
router.post('/ranks', requirePermission('manage_settings'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = csvBodySchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const faction = await loadFaction(factionId);
  if (!faction) {
    error(res, 'NOT_FOUND', 'Faction not found or inactive', 404);
    return;
  }

  const parsedCsv = parseCsvRows(parsed.data.csv);
  if ('error' in parsedCsv) {
    error(res, 'BAD_REQUEST', parsedCsv.error);
    return;
  }
  const { header, rows } = parsedCsv;
  const nameIdx = columnIndex(header, 'name');
  const levelIdx = columnIndex(header, 'level');
  const permsIdx = columnIndex(header, 'permissions');
  if (nameIdx === -1 || levelIdx === -1) {
    error(res, 'BAD_REQUEST', 'CSV must have "Name" and "Level" columns');
    return;
  }

  const validPermissions = FACTION_PERMISSIONS as readonly string[];
  const ranks: RankDef[] = [];
  const result = { imported: 0, skipped: 0, errors: [] as string[] };
  const names = new Set<string>();
  const levels = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i] ?? [];
    const rowNo = i + 2;

    const name = (cols[nameIdx] ?? '').trim();
    if (!name || name.length > 100) {
      result.errors.push(`Row ${rowNo}: name is empty or too long`);
      result.skipped++;
      continue;
    }
    if (names.has(name)) {
      result.errors.push(`Row ${rowNo}: duplicate rank name "${name}"`);
      result.skipped++;
      continue;
    }

    const level = Number((cols[levelIdx] ?? '').trim());
    if (!Number.isInteger(level) || level < 1 || level > 999) {
      result.errors.push(`Row ${rowNo}: level must be a whole number of 1 or more`);
      result.skipped++;
      continue;
    }
    if (levels.has(level)) {
      result.errors.push(`Row ${rowNo}: duplicate level ${level}`);
      result.skipped++;
      continue;
    }

    const permissionList = permsIdx >= 0
      ? (cols[permsIdx] ?? '').split('|').map((p) => p.trim()).filter(Boolean)
      : [];
    const unknown = permissionList.filter((p) => !validPermissions.includes(p));
    if (unknown.length > 0) {
      result.errors.push(`Row ${rowNo}: unknown permissions: ${unknown.join(', ')}`);
      result.skipped++;
      continue;
    }

    names.add(name);
    levels.add(level);
    ranks.push({ name, level, permissions: permissionList });
    result.imported++;
  }

  if (ranks.length === 0) {
    error(res, 'BAD_REQUEST', 'No valid ranks found in the CSV — refusing to wipe the faction\'s ranks');
    return;
  }
  if (ranks.length > 20) {
    error(res, 'BAD_REQUEST', 'A faction can have at most 20 ranks');
    return;
  }

  const removedRanks = (faction.ranks ?? []).map((r) => r.name).filter((n) => !names.has(n));

  await db.transaction(async (tx: TransactionLike) => {
    await tx
      .update(factions)
      .set({ ranks })
      .where(eq(factions.id, factionId));

    // A roster can never display a rank the faction no longer defines —
    // cleared in the same transaction as the replacement, as the settings
    // endpoint does.
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
  });

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'faction_settings',
    entityId: factionId,
    details: {
      source: 'csv_import',
      before: { ranks: faction.ranks },
      after: { ranks },
      ...(removedRanks.length > 0 ? { removedRanks } : {}),
    },
    req,
  });

  success(res, { ...result, removedRanks });
});

export default router;
