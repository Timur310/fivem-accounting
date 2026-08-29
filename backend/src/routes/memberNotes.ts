import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { memberNotes, users, factionMembers, NOTE_CATEGORIES } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router({ mergeParams: true });

// Notes are private admin material: the member they describe must never be
// able to read them, so admin rights are required for every operation here.
router.use(requireAuth, requireFactionMember, requireFactionAdminOrSuperadmin);

// ── Validation schemas ────────────────────────────────

const createNoteSchema = z.object({
  category: z.enum(NOTE_CATEGORIES).default('general'),
  content: z.string().min(1).max(5000),
  isFlagged: z.boolean().optional(),
});

const updateNoteSchema = z.object({
  category: z.enum(NOTE_CATEGORIES).optional(),
  content: z.string().min(1).max(5000).optional(),
  isFlagged: z.boolean().optional(),
});

const listNotesQuerySchema = z.object({
  category: z.enum(NOTE_CATEGORIES).optional(),
  flagged_only: z.enum(['true', 'false']).optional(),
});

/** The member a note is about must belong to this faction. */
async function assertFactionMember(factionId: string, userId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: factionMembers.id })
    .from(factionMembers)
    .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, userId)))
    .limit(1);
  return !!membership;
}

// ── POST / — write a note about a member ─────────────
router.post('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  if (!(await assertFactionMember(factionId, targetUserId))) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  const { category, content, isFlagged } = parsed.data;

  const [note] = await db
    .insert(memberNotes)
    .values({
      factionId,
      targetUserId,
      authorId: req.user!.id,
      category,
      content,
      isFlagged: isFlagged ?? false,
    })
    .returning();

  if (!note) {
    error(res, 'INTERNAL_ERROR', 'Failed to create note', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'member_note',
    entityId: note.id,
    // The note body is deliberately not copied into the audit log: audit logs
    // are readable by every faction admin and the content may be sensitive.
    details: { targetUserId, category, isFlagged: note.isFlagged },
    req,
  });

  success(res, note, 201);
});

// ── GET / — list notes about a member ────────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const query = listNotesQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const conditions = [
    eq(memberNotes.factionId, factionId),
    eq(memberNotes.targetUserId, targetUserId),
  ];
  if (query.data.category) conditions.push(eq(memberNotes.category, query.data.category));
  if (query.data.flagged_only === 'true') conditions.push(eq(memberNotes.isFlagged, true));

  const notes = await db
    .select({
      id: memberNotes.id,
      category: memberNotes.category,
      content: memberNotes.content,
      isFlagged: memberNotes.isFlagged,
      createdAt: memberNotes.createdAt,
      updatedAt: memberNotes.updatedAt,
      authorId: memberNotes.authorId,
      authorUsername: users.username,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(memberNotes)
    .innerJoin(users, eq(memberNotes.authorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(memberNotes.createdAt));

  success(res, notes);
});

// ── PATCH /:noteId — edit content, category or flag ──
router.patch('/:noteId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;
  const noteId = req.params.noteId as string;

  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(memberNotes)
    .where(
      and(
        eq(memberNotes.id, noteId),
        eq(memberNotes.factionId, factionId),
        eq(memberNotes.targetUserId, targetUserId),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Note not found', 404);
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.isFlagged !== undefined) updates.isFlagged = parsed.data.isFlagged;

  const [updated] = await db
    .update(memberNotes)
    .set(updates)
    .where(eq(memberNotes.id, noteId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'member_note',
    entityId: noteId,
    details: {
      targetUserId,
      before: { category: existing.category, isFlagged: existing.isFlagged },
      after: { category: updates.category, isFlagged: updates.isFlagged },
      contentChanged: parsed.data.content !== undefined,
    },
    req,
  });

  success(res, updated);
});

// ── DELETE /:noteId — remove a note ──────────────────
router.delete('/:noteId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;
  const noteId = req.params.noteId as string;

  const [existing] = await db
    .select()
    .from(memberNotes)
    .where(
      and(
        eq(memberNotes.id, noteId),
        eq(memberNotes.factionId, factionId),
        eq(memberNotes.targetUserId, targetUserId),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Note not found', 404);
    return;
  }

  // Hard delete: unlike entries and payouts a note is not part of the ledger,
  // and keeping retracted observations about people around is worse than
  // losing them. The audit log records that it happened.
  await db.delete(memberNotes).where(eq(memberNotes.id, noteId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'member_note',
    entityId: noteId,
    details: { targetUserId, category: existing.category },
    req,
  });

  success(res, { id: noteId, deleted: true });
});

export default router;
