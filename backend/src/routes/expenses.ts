import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { expenses, itemTypes, users, EXPENSE_CATEGORIES } from '../db/schema.js';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { parsePagination } from '../lib/types.js';
import { toDateString } from '../lib/date.js';

const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireModule('expenses'));

// ── Validation schemas ────────────────────────────────

const createExpenseSchema = z.object({
  itemTypeId: z.string().uuid(),
  amount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    'Amount must be a positive number',
  ),
  category: z.enum(EXPENSE_CATEGORIES).default('other'),
  description: z.string().max(500).optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
});

const updateExpenseSchema = z.object({
  amount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    'Amount must be a positive number',
  ).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  description: z.string().max(500).nullable().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
});

const listQuerySchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  item_type_id: z.string().uuid().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

// ── POST / — record an expense ───────────────────────
router.post('/', requirePermission('manage_expenses'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = createExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { itemTypeId, amount, category, description, expenseDate } = parsed.data;

  const [itemType] = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.id, itemTypeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  if (!itemType) {
    error(res, 'NOT_FOUND', 'Item type not found in this faction', 404);
    return;
  }

  // A date is when the cost was paid, and a paid cost cannot be paid tomorrow.
  // Same rule payouts follow.
  const date = expenseDate ?? toDateString(new Date());
  if (date > toDateString(new Date())) {
    error(res, 'VALIDATION_ERROR', 'Expense date cannot be in the future');
    return;
  }

  const [created] = await db
    .insert(expenses)
    .values({
      factionId,
      createdBy: req.user!.id,
      itemTypeId,
      category,
      amount,
      description: description ?? null,
      expenseDate: date,
    })
    .returning();

  if (!created) {
    error(res, 'INTERNAL_ERROR', 'Failed to record expense', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'expense',
    entityId: created.id,
    details: { itemTypeId, amount: Number(amount), category, expenseDate: date },
    req,
  });

  void dispatchDiscord(factionId, {
    type: 'expense_recorded',
    actorUserId: req.user!.id,
    itemTypeId: created.itemTypeId,
    amount: created.amount,
    category: created.category,
    description: created.description,
  });

  success(res, created, 201);
});

// ── GET / — list expenses ────────────────────────────
// Readable by any faction member: expenses are what the vault paid to keep
// running, and the treasury balances that already show them are member-visible.
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { category, item_type_id, date_from, date_to, page: pageStr, page_size: pageSizeStr } = query.data;
  const { page, pageSize, offset } = parsePagination({ page: pageStr, page_size: pageSizeStr });

  const where = and(
    eq(expenses.factionId, factionId),
    eq(expenses.isDeleted, false),
    category ? eq(expenses.category, category) : undefined,
    item_type_id ? eq(expenses.itemTypeId, item_type_id) : undefined,
    date_from ? gte(expenses.expenseDate, date_from) : undefined,
    date_to ? lte(expenses.expenseDate, date_to) : undefined,
  );

  const [items, countResult, totals] = await Promise.all([
    db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        category: expenses.category,
        description: expenses.description,
        expenseDate: expenses.expenseDate,
        createdAt: expenses.createdAt,
        createdBy: expenses.createdBy,
        creatorUsername: users.username,
        creatorInGameName: users.inGameName,
        itemTypeId: expenses.itemTypeId,
        itemTypeName: itemTypes.name,
        itemUnit: itemTypes.unit,
        itemIsCurrency: itemTypes.isCurrency,
        itemImageUrl: itemTypes.imageUrl,
      itemIcon: itemTypes.icon,
      itemCategory: itemTypes.category,
      })
      .from(expenses)
      .innerJoin(users, eq(expenses.createdBy, users.id))
      .innerJoin(itemTypes, eq(expenses.itemTypeId, itemTypes.id))
      .where(where)
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(expenses)
      .where(where),
    // Totals per category over the same filtered set, so the list can be read
    // against its own sum without a second request.
    db
      .select({
        category: expenses.category,
        total: sql<string>`COALESCE(SUM(CAST(${expenses.amount} AS NUMERIC)), 0)`,
      })
      .from(expenses)
      .where(where)
      .groupBy(expenses.category),
  ]);

  success(
    res,
    {
      expenses: items,
      categoryTotals: totals.map((r) => ({ category: r.category, total: Number(r.total) })),
    },
    200,
    { page, page_size: pageSize, total_count: countResult[0]?.count ?? 0 },
  );
});

// ── PATCH /:expenseId — edit an expense ──────────────
router.patch('/:expenseId', requirePermission('manage_expenses'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const expenseId = req.params.expenseId as string;

  const parsed = updateExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.factionId, factionId)))
    .limit(1);
  if (!existing || existing.isDeleted) {
    error(res, 'NOT_FOUND', 'Expense not found', 404);
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.amount !== undefined) updates.amount = parsed.data.amount;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.expenseDate !== undefined) {
    if (parsed.data.expenseDate > toDateString(new Date())) {
      error(res, 'VALIDATION_ERROR', 'Expense date cannot be in the future');
      return;
    }
    updates.expenseDate = parsed.data.expenseDate;
  }

  if (Object.keys(updates).length === 0) {
    error(res, 'VALIDATION_ERROR', 'Provide at least one of: amount, category, description, expenseDate');
    return;
  }
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(expenses)
    .set(updates)
    .where(eq(expenses.id, expenseId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'expense',
    entityId: expenseId,
    details: {
      before: {
        amount: existing.amount,
        category: existing.category,
        description: existing.description,
        expenseDate: existing.expenseDate,
      },
      after: updates,
    },
    req,
  });

  success(res, updated);
});

// ── DELETE /:expenseId — remove an expense ───────────
router.delete('/:expenseId', requirePermission('manage_expenses'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const expenseId = req.params.expenseId as string;

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.factionId, factionId)))
    .limit(1);
  if (!existing || existing.isDeleted) {
    error(res, 'NOT_FOUND', 'Expense not found', 404);
    return;
  }

  await db
    .update(expenses)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(expenses.id, expenseId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'expense',
    entityId: expenseId,
    details: { amount: Number(existing.amount), category: existing.category },
    req,
  });

  void dispatchDiscord(factionId, {
    type: 'expense_deleted',
    actorUserId: req.user!.id,
    itemTypeId: existing.itemTypeId,
    amount: existing.amount,
    category: existing.category,
  });

  success(res, { id: expenseId, deleted: true });
});

export default router;
