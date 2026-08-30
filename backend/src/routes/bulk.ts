import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { factionMembers, users, entries, itemTypes, factions } from '../db/schema.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { todayDateString } from '../lib/date.js';

const router = Router({ mergeParams: true });

// requireFactionMember must run first: it resolves req.factionRole, which the
// admin guard then checks. Without it factionRole is undefined and every
// request is rejected — including a superadmin's.
router.use(requireAuth, requireFactionMember, requireFactionAdminOrSuperadmin);

// ── POST /members — batch add members ─────────────────
const bulkAddMembersSchema = z.object({
  discordIds: z.array(z.string().min(1)).min(1).max(50),
});

router.post('/members', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = bulkAddMembersSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { discordIds } = parsed.data;

  // Find all users by discord IDs
  const foundUsers = await db
    .select()
    .from(users)
    .where(inArray(users.discordId, discordIds));

  const foundMap = new Map(foundUsers.map((u) => [u.discordId, u]));

  // Check for unknown discord IDs
  const unknownIds = discordIds.filter((id) => !foundMap.has(id));
  // Check for already members
  const existingMembers = await db
    .select({ userId: factionMembers.userId })
    .from(factionMembers)
    .where(eq(factionMembers.factionId, factionId));
  const existingSet = new Set(existingMembers.map((m) => m.userId));

  const toAdd = foundUsers.filter((u) => !existingSet.has(u.id));

  if (toAdd.length === 0) {
    error(res, 'BAD_REQUEST', 'All users are already members or not found');
    return;
  }

  // Insert in one batch
  const values = toAdd.map((u) => ({
    factionId,
    userId: u.id,
    role: 'member' as const,
  }));

  const inserted = await db.insert(factionMembers).values(values).returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'bulk_create',
    entityType: 'member',
    details: {
      addedCount: inserted.length,
      unknownDiscordIds: unknownIds,
      alreadyMembers: discordIds.length - unknownIds.length - toAdd.length,
      addedUsers: toAdd.map((u) => ({ discordId: u.discordId, username: u.username })),
    },
    req,
  });

  success(res, {
    added: inserted.length,
    skipped: {
      notFound: unknownIds,
      alreadyMembers: discordIds.length - unknownIds.length - toAdd.length,
    },
  });
});

// ── POST /entries/bulk-delete — bulk soft-delete entries ─
const bulkDeleteEntriesSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(200),
});

router.post('/entries/bulk-delete', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = bulkDeleteEntriesSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { entryIds } = parsed.data;

  // Verify all entries belong to this faction and are not already deleted
  const existingEntries = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        inArray(entries.id, entryIds),
        eq(entries.factionId, factionId),
        eq(entries.isDeleted, false),
      ),
    );

  const validIds = existingEntries.map((e) => e.id);
  if (validIds.length === 0) {
    error(res, 'BAD_REQUEST', 'No valid entries found to delete');
    return;
  }

  await db
    .update(entries)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(inArray(entries.id, validIds));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'bulk_delete',
    entityType: 'entry',
    details: { deletedCount: validIds.length, requestedCount: entryIds.length },
    req,
  });

  success(res, { deletedCount: validIds.length });
});

// ── POST /entries/import — CSV import ─────────────────
const csvImportSchema = z.object({
  csv: z.string().min(10),
});

router.post('/entries/import', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = csvImportSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  // Verify faction is active
  const [faction] = await db
    .select()
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);
  if (!faction || !faction.isActive) {
    error(res, 'NOT_FOUND', 'Faction not found or inactive', 404);
    return;
  }

  // Get active item types for this faction
  const types = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.factionId, factionId), eq(itemTypes.isActive, true)));
  const typeMap = new Map(types.map((t) => [t.name.toLowerCase(), t]));

  const lines = parsed.data.csv.trim().split('\n');
  if (lines.length < 2) {
    error(res, 'BAD_REQUEST', 'CSV must have a header row and at least one data row');
    return;
  }

  // Parse header to find columns
  const header = parseCSVLine(lines[0] ?? '').map((h) => h.trim().toLowerCase());
  const itemTypeIdx = header.findIndex((h) => h.includes('item type') || h.includes('item_type'));
  const amountIdx = header.findIndex((h) => h === 'amount');
  const dateIdx = header.findIndex((h) => h === 'date' || h === 'entry_date' || h.includes('entry date'));
  const descIdx = header.findIndex((h) => h === 'description' || h === 'desc');
  const usernameIdx = header.findIndex((h) => h === 'member' || h === 'username' || h === 'user');

  if (itemTypeIdx === -1 || amountIdx === -1) {
    error(res, 'BAD_REQUEST', 'CSV must have "Item Type" and "Amount" columns');
    return;
  }

  const results = { imported: 0, skipped: 0, errors: [] as string[] };
  const rows: { factionId: string; userId: string; itemTypeId: string; amount: string; description: string | null; entryDate: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i] ?? '');
    if (cols.length < 2) continue;

    const itemTypeName = (cols[itemTypeIdx] || '').trim().toLowerCase();
    const amountStr = (cols[amountIdx] || '').trim().replace(/[^0-9.]/g, '');
    const dateVal = dateIdx >= 0 ? (cols[dateIdx] || '').trim() : todayDateString();
    const desc = descIdx >= 0 ? (cols[descIdx] || '').trim() : null;
    const memberName = usernameIdx >= 0 ? (cols[usernameIdx] || '').trim() : null;

    const itemType = typeMap.get(itemTypeName);
    if (!itemType) {
      results.errors.push(`Row ${i + 1}: Unknown item type "${itemTypeName}"`);
      results.skipped++;
      continue;
    }

    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      results.errors.push(`Row ${i + 1}: Invalid amount "${amountStr}"`);
      results.skipped++;
      continue;
    }

    // Validate date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      results.errors.push(`Row ${i + 1}: Invalid date format, use YYYY-MM-DD`);
      results.skipped++;
      continue;
    }

    // Find user by username if provided, otherwise use importing user
    let userId = req.user!.id;
    if (memberName) {
      const [target] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, memberName))
        .limit(1);
      if (target) {
        userId = target.id;
      } else {
        results.errors.push(`Row ${i + 1}: User "${memberName}" not found, using importer`);
      }
    }

    rows.push({
      factionId,
      userId,
      itemTypeId: itemType.id,
      amount: amount.toFixed(2),
      description: desc || null,
      entryDate: dateVal,
    });
    results.imported++;
  }

  // Batch insert
  if (rows.length > 0) {
    await db.insert(entries).values(rows);
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'import',
    entityType: 'entry',
    details: { ...results, totalRows: lines.length - 1 },
    req,
  });

  success(res, results);
});

// ── CSV line parser (handles quoted fields) ──────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

export default router;
