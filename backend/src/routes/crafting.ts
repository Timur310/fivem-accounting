import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import {
  craftingRecipes,
  craftingRecipeItems,
  crafts,
  craftMovements,
  entries,
  payouts,
  itemTypes,
  users,
  CREDIT_OUTPUT_TO,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { resolveAnonymousUserId } from '../lib/anonymous.js';
import { todayDateString } from '../lib/date.js';
import {
  balancesFor,
  compareQuantity,
  loadRecipe,
  lockItemTypes,
  maxCraftable,
  scaleQuantity,
  shortfalls,
  type LoadedRecipe,
} from '../lib/crafting.js';

/**
 * The crafting bench.
 *
 * Factions in these servers turn materials into things constantly, and until
 * now the app made them write that down as a withdrawal per component plus an
 * entry for the result — every time, by hand. A recipe says it once; running
 * it writes all of those movements in one transaction, or none of them.
 *
 * Nothing here invents a new kind of money. An input leaves the vault as a
 * completed payout and an output arrives as an entry, exactly as the
 * laundering desk does it, so every balance, report and export in the app
 * counts a craft correctly without knowing crafting exists.
 */
const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const quantityField = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Quantity must be a positive number with up to 2 decimal places')
  .refine((v) => Number(v) > 0, 'Quantity must be greater than zero');

const lineSchema = z.object({
  itemTypeId: z.string().uuid(),
  quantity: quantityField,
});

const recipeSchema = z.object({
  name: z.string().trim().min(1, 'Give the recipe a name').max(100),
  description: z.string().max(1000).optional(),
  creditOutputTo: z.enum(CREDIT_OUTPUT_TO).default('nobody'),
  isActive: z.boolean().default(true),
  inputs: z.array(lineSchema).min(1, 'A recipe needs at least one input'),
  outputs: z.array(lineSchema).min(1, 'A recipe needs at least one output'),
});

const recipeUpdateSchema = recipeSchema.partial();

const craftSchema = z.object({
  recipeId: z.string().uuid(),
  // Capped rather than unbounded: a batch of ten thousand is a typo, and the
  // transaction would hold its locks for as long as it took to believe it.
  quantity: z.number().int().min(1).max(1000).default(1),
  notes: z.string().max(500).optional(),
  date: z.string().date().optional(),
});

/** Duplicate item types within one side of a recipe are always a mistake. */
function hasDuplicates(lines: { itemTypeId: string }[]): boolean {
  return new Set(lines.map((l) => l.itemTypeId)).size !== lines.length;
}

/**
 * Every item type a recipe names must be this faction's, and active.
 *
 * Returns the offending message, or null when the lines are fine.
 */
async function validateLines(
  factionId: string,
  lines: { itemTypeId: string }[],
): Promise<string | null> {
  const ids = [...new Set(lines.map((l) => l.itemTypeId))];
  if (ids.length === 0) return null;

  const rows = await db
    .select({ id: itemTypes.id, name: itemTypes.name, isActive: itemTypes.isActive })
    .from(itemTypes)
    .where(and(eq(itemTypes.factionId, factionId), inArray(itemTypes.id, ids)));

  const found = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = found.get(id);
    if (!row) return 'That item type does not belong to this faction';
    if (!row.isActive) return `"${row.name}" is retired — reactivate it or pick another item type`;
  }
  return null;
}

/** A recipe as the screens want it: lines, what the vault holds, what it can run. */
async function presentRecipe(factionId: string, recipe: LoadedRecipe) {
  const balances = await balancesFor(
    factionId,
    recipe.inputs.map((l) => l.itemTypeId),
  );

  return {
    ...recipe,
    inputs: recipe.inputs.map((line) => ({
      ...line,
      available: balances.get(line.itemTypeId) ?? '0',
    })),
    maxCraftable: maxCraftable(recipe, balances),
  };
}

// ── GET /recipes — the bench, and what it can make today ──
router.get('/recipes', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const rows = await db
    .select({ id: craftingRecipes.id })
    .from(craftingRecipes)
    .where(eq(craftingRecipes.factionId, factionId))
    .orderBy(craftingRecipes.name);

  const loaded = await Promise.all(rows.map((r) => loadRecipe(factionId, r.id)));
  const present = await Promise.all(
    loaded.filter((r): r is LoadedRecipe => r !== null).map((r) => presentRecipe(factionId, r)),
  );

  success(res, { recipes: present });
});

// ── POST /recipes — write one down ───────────────────
router.post('/recipes', requirePermission('manage_crafting'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = recipeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const { name, description, creditOutputTo, isActive, inputs, outputs } = parsed.data;

  if (hasDuplicates(inputs) || hasDuplicates(outputs)) {
    error(res, 'VALIDATION_ERROR', 'Each item type can appear once as an input and once as an output');
    return;
  }

  const bad = await validateLines(factionId, [...inputs, ...outputs]);
  if (bad) {
    error(res, 'VALIDATION_ERROR', bad);
    return;
  }

  let recipeId: string;
  try {
    recipeId = await db.transaction(async (tx: TransactionLike) => {
      const [recipe] = await tx
        .insert(craftingRecipes)
        .values({
          factionId,
          name,
          description: description?.trim() || null,
          creditOutputTo,
          isActive,
          createdBy: req.user!.id,
        })
        .returning();
      if (!recipe) throw new Error('Failed to save the recipe');

      await tx.insert(craftingRecipeItems).values([
        ...inputs.map((l) => ({ recipeId: recipe.id, itemTypeId: l.itemTypeId, role: 'input', quantity: l.quantity })),
        ...outputs.map((l) => ({ recipeId: recipe.id, itemTypeId: l.itemTypeId, role: 'output', quantity: l.quantity })),
      ]);

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'crafting_recipe',
        entityId: recipe.id,
        details: { name, creditOutputTo, inputs, outputs },
        req,
        tx,
      });

      return recipe.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      error(res, 'VALIDATION_ERROR', 'This faction already has a recipe with that name');
      return;
    }
    console.error('[CRAFTING RECIPE ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to save the recipe', 500);
    return;
  }

  const recipe = await loadRecipe(factionId, recipeId);
  success(res, { recipe: recipe ? await presentRecipe(factionId, recipe) : null }, 201);
});

// ── PATCH /recipes/:recipeId — change one ────────────
//
// Lines are replaced wholesale rather than diffed. A recipe is half a dozen
// rows, and "these are the inputs now" is a far easier thing to be sure about
// than a merge — past crafts are unaffected either way, because they wrote
// real movements at the time.
router.patch('/recipes/:recipeId', requirePermission('manage_crafting'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const recipeId = req.params.recipeId as string;

  const parsed = recipeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const { name, description, creditOutputTo, isActive, inputs, outputs } = parsed.data;

  const existing = await loadRecipe(factionId, recipeId);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Recipe not found', 404);
    return;
  }

  if ((inputs && hasDuplicates(inputs)) || (outputs && hasDuplicates(outputs))) {
    error(res, 'VALIDATION_ERROR', 'Each item type can appear once as an input and once as an output');
    return;
  }

  const lines = [...(inputs ?? []), ...(outputs ?? [])];
  const bad = await validateLines(factionId, lines);
  if (bad) {
    error(res, 'VALIDATION_ERROR', bad);
    return;
  }

  try {
    await db.transaction(async (tx: TransactionLike) => {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description.trim() || null;
      if (creditOutputTo !== undefined) updates.creditOutputTo = creditOutputTo;
      if (isActive !== undefined) updates.isActive = isActive;

      await tx.update(craftingRecipes).set(updates).where(eq(craftingRecipes.id, recipeId));

      // Only the sides that were sent are replaced, so a PATCH that renames a
      // recipe does not silently empty its outputs.
      for (const [role, sent] of [['input', inputs], ['output', outputs]] as const) {
        if (!sent) continue;
        await tx
          .delete(craftingRecipeItems)
          .where(and(eq(craftingRecipeItems.recipeId, recipeId), eq(craftingRecipeItems.role, role)));
        if (sent.length > 0) {
          await tx.insert(craftingRecipeItems).values(
            sent.map((l) => ({ recipeId, itemTypeId: l.itemTypeId, role, quantity: l.quantity })),
          );
        }
      }

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'update',
        entityType: 'crafting_recipe',
        entityId: recipeId,
        details: { name: name ?? existing.name, creditOutputTo, isActive, inputs, outputs },
        req,
        tx,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      error(res, 'VALIDATION_ERROR', 'This faction already has a recipe with that name');
      return;
    }
    console.error('[CRAFTING RECIPE ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to update the recipe', 500);
    return;
  }

  const recipe = await loadRecipe(factionId, recipeId);
  success(res, { recipe: recipe ? await presentRecipe(factionId, recipe) : null });
});

// ── DELETE /recipes/:recipeId ────────────────────────
//
// Really deleted. Past crafts keep their snapshotted name and their movements,
// so nothing in the ledger depends on the recipe surviving — and a faction
// that wants the recipe out of the picker without losing it has `isActive`.
router.delete('/recipes/:recipeId', requirePermission('manage_crafting'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const recipeId = req.params.recipeId as string;

  const existing = await loadRecipe(factionId, recipeId);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Recipe not found', 404);
    return;
  }

  await db.transaction(async (tx: TransactionLike) => {
    await tx.delete(craftingRecipes).where(eq(craftingRecipes.id, recipeId));
    await createAuditLog({
      userId: req.user!.id,
      factionId,
      action: 'delete',
      entityType: 'crafting_recipe',
      entityId: recipeId,
      details: { name: existing.name },
      req,
      tx,
    });
  });

  success(res, { deleted: true });
});

// ── POST /crafts — run a recipe ──────────────────────
router.post('/crafts', requirePermission('craft'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = craftSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const { recipeId, quantity, notes, date } = parsed.data;

  const recipe = await loadRecipe(factionId, recipeId);
  if (!recipe) {
    error(res, 'NOT_FOUND', 'Recipe not found', 404);
    return;
  }
  if (!recipe.isActive) {
    error(res, 'VALIDATION_ERROR', `"${recipe.name}" is retired and cannot be crafted`);
    return;
  }
  // A retired item type would take the craft off the treasury screen's radar
  // on one side while still moving the balance on the other.
  const retired = [...recipe.inputs, ...recipe.outputs].find((l) => !l.isActive);
  if (retired) {
    error(res, 'VALIDATION_ERROR', `"${retired.itemTypeName}" is retired — this recipe cannot run until it is reactivated`);
    return;
  }

  const craftDate = date ?? todayDateString();
  const note = notes?.trim()
    || `Crafted ${quantity} × ${recipe.name}`;

  let result;
  try {
    result = await db.transaction(async (tx: TransactionLike) => {
      const touched = [...recipe.inputs, ...recipe.outputs].map((l) => l.itemTypeId);
      await lockItemTypes(tx, touched);

      // Read *after* the lock: anything that got in first has already
      // committed its movements by the time this line runs.
      const balances = await balancesFor(factionId, recipe.inputs.map((l) => l.itemTypeId), tx);
      const missing = shortfalls(recipe, balances, quantity);
      if (missing.length > 0) throw new ShortfallError(missing);

      const anonymousUserId = await resolveAnonymousUserId(tx);
      // Whose entry the output is. `nobody` keeps crafting off the
      // leaderboards, the way laundering is; `crafter` is for recipes where
      // running one is real work worth counting.
      const outputOwner = recipe.creditOutputTo === 'crafter' ? req.user!.id : anonymousUserId;

      const [craft] = await tx
        .insert(crafts)
        .values({
          factionId,
          recipeId: recipe.id,
          recipeName: recipe.name,
          quantity,
          craftedBy: req.user!.id,
          craftDate,
          notes: notes?.trim() || null,
        })
        .returning();
      if (!craft) throw new Error('Failed to record the craft');

      const movements: (typeof craftMovements.$inferInsert)[] = [];

      // Materials out, as completed payouts against the placeholder: they are
      // gone from the vault the moment the bench consumes them, and no member
      // received them.
      for (const line of recipe.inputs) {
        const amount = scaleQuantity(line.quantity, quantity);
        const [payout] = await tx
          .insert(payouts)
          .values({
            factionId,
            recipientUserId: anonymousUserId,
            createdBy: req.user!.id,
            itemTypeId: line.itemTypeId,
            amount,
            description: note,
            payoutDate: craftDate,
            status: 'completed',
          })
          .returning();
        if (!payout) throw new Error('Failed to record the materials used');
        movements.push({ craftId: craft.id, role: 'input', itemTypeId: line.itemTypeId, quantity: amount, payoutId: payout.id });
      }

      // And the results in.
      for (const line of recipe.outputs) {
        const amount = scaleQuantity(line.quantity, quantity);
        const [entry] = await tx
          .insert(entries)
          .values({
            factionId,
            userId: outputOwner,
            itemTypeId: line.itemTypeId,
            amount,
            description: note,
            entryDate: craftDate,
          })
          .returning();
        if (!entry) throw new Error('Failed to record what was made');
        movements.push({ craftId: craft.id, role: 'output', itemTypeId: line.itemTypeId, quantity: amount, entryId: entry.id });
      }

      await tx.insert(craftMovements).values(movements);

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'craft',
        entityId: craft.id,
        details: {
          recipeId: recipe.id,
          recipeName: recipe.name,
          quantity,
          creditOutputTo: recipe.creditOutputTo,
          inputs: recipe.inputs.map((l) => ({ itemTypeId: l.itemTypeId, itemTypeName: l.itemTypeName, amount: scaleQuantity(l.quantity, quantity) })),
          outputs: recipe.outputs.map((l) => ({ itemTypeId: l.itemTypeId, itemTypeName: l.itemTypeName, amount: scaleQuantity(l.quantity, quantity) })),
        },
        req,
        tx,
      });

      return { craft, movements };
    });
  } catch (err) {
    if (err instanceof ShortfallError) {
      // Named, not counted. "Not enough materials" sends somebody to the
      // treasury screen to work out which one; naming the first shortfall and
      // how many others there are tells them where to look.
      const first = err.missing[0]!;
      const others = err.missing.length - 1;
      error(
        res,
        'BAD_REQUEST',
        `Not enough ${first.itemTypeName}: this needs ${first.required} and the treasury holds ${first.available}` +
          (others > 0 ? ` (and ${others} other material${others === 1 ? '' : 's'} short)` : ''),
      );
      return;
    }
    console.error('[CRAFT ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to record the craft', 500);
    return;
  }

  void dispatchDiscord(factionId, {
    type: 'craft_completed',
    actorUserId: req.user!.id,
    recipeName: recipe.name,
    quantity,
    inputs: recipe.inputs.map((l) => ({ itemTypeId: l.itemTypeId, amount: scaleQuantity(l.quantity, quantity) })),
    outputs: recipe.outputs.map((l) => ({ itemTypeId: l.itemTypeId, amount: scaleQuantity(l.quantity, quantity) })),
  });

  success(res, { craft: result.craft, movements: result.movements }, 201);
});

// ── GET /crafts — what has been made ─────────────────
router.get('/crafts', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const rows = await db
    .select({
      id: crafts.id,
      recipeId: crafts.recipeId,
      recipeName: crafts.recipeName,
      quantity: crafts.quantity,
      craftDate: crafts.craftDate,
      notes: crafts.notes,
      createdAt: crafts.createdAt,
      revertedAt: crafts.revertedAt,
      craftedBy: crafts.craftedBy,
      crafterName: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
    })
    .from(crafts)
    .innerJoin(users, eq(crafts.craftedBy, users.id))
    .where(eq(crafts.factionId, factionId))
    .orderBy(desc(crafts.createdAt))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  const moves = ids.length
    ? await db
        .select({
          craftId: craftMovements.craftId,
          role: craftMovements.role,
          itemTypeId: craftMovements.itemTypeId,
          quantity: craftMovements.quantity,
          itemTypeName: itemTypes.name,
          unit: itemTypes.unit,
          isCurrency: itemTypes.isCurrency,
          icon: itemTypes.icon,
        })
        .from(craftMovements)
        .innerJoin(itemTypes, eq(craftMovements.itemTypeId, itemTypes.id))
        .where(inArray(craftMovements.craftId, ids))
    : [];

  success(res, {
    crafts: rows.map((r) => ({
      ...r,
      inputs: moves.filter((m) => m.craftId === r.id && m.role === 'input'),
      outputs: moves.filter((m) => m.craftId === r.id && m.role === 'output'),
    })),
  });
});

// ── POST /crafts/:craftId/revert — take it back ──────
router.post('/crafts/:craftId/revert', requirePermission('manage_crafting'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const craftId = req.params.craftId as string;

  let reverted;
  try {
    reverted = await db.transaction(async (tx: TransactionLike) => {
      const [craft] = await tx
        .select()
        .from(crafts)
        .where(and(eq(crafts.id, craftId), eq(crafts.factionId, factionId)))
        .limit(1)
        .for('update');

      if (!craft) throw new NotFoundError();
      if (craft.revertedAt) throw new AlreadyRevertedError();

      const moves = await tx
        .select()
        .from(craftMovements)
        .where(eq(craftMovements.craftId, craftId));

      await lockItemTypes(tx, moves.map((m) => m.itemTypeId));

      // Putting the materials back is free; taking the product back is not.
      // If the faction has already spent what this craft made, un-making it
      // would drive that balance below zero — which is a real state the app
      // allows, but never one it should enter by accident on a correction.
      const outputs = moves.filter((m) => m.role === 'output');
      const balances = await balancesFor(factionId, outputs.map((m) => m.itemTypeId), tx);
      const names = new Map(
        (
          await tx
            .select({ id: itemTypes.id, name: itemTypes.name })
            .from(itemTypes)
            .where(inArray(itemTypes.id, outputs.map((m) => m.itemTypeId)))
        ).map((r) => [r.id, r.name]),
      );
      for (const out of outputs) {
        const have = balances.get(out.itemTypeId) ?? '0';
        if (compareQuantity(have, out.quantity) < 0) {
          throw new OverspentError(names.get(out.itemTypeId) ?? 'that item', out.quantity, have);
        }
      }

      const entryIds = moves.map((m) => m.entryId).filter((id): id is string => !!id);
      const payoutIds = moves.map((m) => m.payoutId).filter((id): id is string => !!id);

      // Soft-deleted, not removed: the ledger keeps saying what happened, and
      // every balance query in the app already ignores `is_deleted` rows.
      if (entryIds.length) {
        await tx
          .update(entries)
          .set({ isDeleted: true, updatedAt: new Date() })
          .where(inArray(entries.id, entryIds));
      }
      if (payoutIds.length) {
        await tx
          .update(payouts)
          .set({ isDeleted: true, updatedAt: new Date() })
          .where(inArray(payouts.id, payoutIds));
      }

      await tx
        .update(crafts)
        .set({ revertedAt: new Date(), revertedBy: req.user!.id })
        .where(eq(crafts.id, craftId));

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'delete',
        entityType: 'craft',
        entityId: craftId,
        details: { recipeName: craft.recipeName, quantity: craft.quantity, entryIds, payoutIds },
        req,
        tx,
      });

      return { craft, moves };
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      error(res, 'NOT_FOUND', 'Craft not found', 404);
      return;
    }
    if (err instanceof AlreadyRevertedError) {
      error(res, 'VALIDATION_ERROR', 'This craft has already been reverted');
      return;
    }
    if (err instanceof OverspentError) {
      error(
        res,
        'BAD_REQUEST',
        `The treasury only holds ${err.available} ${err.itemTypeName} — reverting this craft would take back ${err.required} and leave the balance negative`,
      );
      return;
    }
    console.error('[CRAFT REVERT ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to revert the craft', 500);
    return;
  }

  void dispatchDiscord(factionId, {
    type: 'craft_reverted',
    actorUserId: req.user!.id,
    recipeName: reverted.craft.recipeName,
    quantity: reverted.craft.quantity,
    crafterUserId: reverted.craft.craftedBy,
  });

  success(res, { reverted: true });
});

/** Thrown inside the transaction so the catch can answer 400, not 500. */
class ShortfallError extends Error {
  constructor(public missing: ReturnType<typeof shortfalls>) {
    super('Insufficient materials');
  }
}
class NotFoundError extends Error {}
class AlreadyRevertedError extends Error {}
class OverspentError extends Error {
  constructor(public itemTypeName: string, public required: string, public available: string) {
    super('Reverting would overdraw the treasury');
  }
}

/** Postgres' unique-violation code, so a duplicate name reads as a 400. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export default router;
