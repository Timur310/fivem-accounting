import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { discordReminders, discordIntegrations, factionMembers, users } from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { guildMemberExists, postToChannel, recordDeliveryOutcome } from '../lib/discord.js';
import { buildReminderMessage } from '../lib/reminderMessage.js';
import {
  nextRun,
  REMINDER_SCHEDULE_TYPES,
  TIME_OF_DAY_PATTERN,
  type ReminderSchedule,
} from '../lib/reminderSchedule.js';

const router = asyncRouter({ mergeParams: true });

// Same gate as the rest of the Discord screen: scheduling a message into the
// faction's server is the same kind of reach as routing events there.
router.use(requireAuth, requireFactionMember, requirePermission('manage_discord'));

/** How many a faction may keep. High enough never to be met in practice, low
 *  enough that a scripted client cannot fill the runner's queue. */
const MAX_REMINDERS = 50;

const reminderSchema = z
  .object({
    channelId: z.string().regex(/^\d{17,20}$/, 'Not a valid Discord channel id'),
    channelName: z.string().max(120).optional(),
    title: z.string().trim().max(120).optional(),
    message: z.string().trim().min(1, 'A reminder needs something to say').max(1500),
    scheduleType: z.enum(REMINDER_SCHEDULE_TYPES),
    timeOfDay: z.string().regex(TIME_OF_DAY_PATTERN, 'Time must be HH:MM').optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    runAt: z.string().datetime({ offset: true }).optional(),
    // Discord role snowflakes, and this app's own user ids. Capped because a
    // message that pings forty roles is not a reminder, it is an attack on the
    // channel.
    mentionRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).max(10).optional(),
    mentionUserIds: z.array(z.string().uuid()).max(25).optional(),
    isEnabled: z.boolean().optional().default(true),
  })
  // Each schedule type needs a different subset of the fields, and a reminder
  // missing the one field that says *when* would sit in the table looking
  // configured and never fire. Refusing on the way in is the only place this
  // can be caught while somebody is still looking at the form.
  .superRefine((value, ctx) => {
    const need = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (value.scheduleType === 'once') {
      if (!value.runAt) {
        need('runAt', 'A one-off reminder needs a date and time');
      } else if (value.isEnabled && new Date(value.runAt).getTime() <= Date.now()) {
        // Only checked while the reminder is meant to fire. A one-off switches
        // itself off once it has been sent, and its moment is then in the past
        // forever — without this, editing or even switching off an already-sent
        // reminder would be refused for a date the user is not changing.
        need('runAt', 'That moment has already passed — pick a new date to schedule it again');
      }
      return;
    }

    if (!value.timeOfDay) need('timeOfDay', 'A repeating reminder needs a time of day');
    if (value.scheduleType === 'weekly' && !value.weekdays?.length) {
      need('weekdays', 'Pick at least one day of the week');
    }
    if (value.scheduleType === 'monthly' && !value.dayOfMonth) {
      need('dayOfMonth', 'Pick a day of the month');
    }
  });

type ReminderInput = z.infer<typeof reminderSchema>;

/** The schedule an input describes, for computing the first run. */
function scheduleFromInput(input: ReminderInput): ReminderSchedule | null {
  switch (input.scheduleType) {
    case 'once':
      return input.runAt ? { type: 'once', runAt: new Date(input.runAt) } : null;
    case 'daily':
      return input.timeOfDay ? { type: 'daily', timeOfDay: input.timeOfDay } : null;
    case 'weekly':
      return input.timeOfDay && input.weekdays?.length
        ? { type: 'weekly', timeOfDay: input.timeOfDay, weekdays: input.weekdays }
        : null;
    case 'monthly':
      return input.timeOfDay && input.dayOfMonth
        ? { type: 'monthly', timeOfDay: input.timeOfDay, dayOfMonth: input.dayOfMonth }
        : null;
    default:
      return null;
  }
}

/**
 * Everyone named for a ping must be in this faction.
 *
 * Without the check, any id at all could be pinged from a faction's channel —
 * including a member of some other faction, whose Discord this one has no
 * business notifying.
 */
/** A tagged member whose ping will not actually reach them. */
export interface UnpingableMember {
  userId: string;
  name: string;
  reason: 'not_in_server';
}

/**
 * Which of these tagged members will not actually be pinged.
 *
 * Reported rather than refused. A reminder that tags eight people and reaches
 * seven is still worth sending, and a leader who tags somebody before they
 * join the Discord server is doing something reasonable — they simply need to
 * know it will be silent until that person arrives.
 *
 * One way a tag goes nowhere, and it is invisible from the outside: `<@id>`
 * for somebody who is not a guild member renders as a mention and notifies
 * nobody. The message looks completely correct in the channel and their client
 * never lights up.
 *
 * Whether they have signed into this app is not part of the question. That was
 * the original test and it was the wrong one — see resolveMentions.
 *
 * Runs at save time and only over the tagged ids — at most 25 — so it costs a
 * handful of requests when somebody is looking at the screen, rather than a
 * burst against Discord every time the settings page renders.
 */
async function unpingableMembers(
  factionId: string,
  userIds: string[],
): Promise<UnpingableMember[]> {
  if (userIds.length === 0) return [];

  const rows = await db
    .select({
      id: users.id,
      discordId: users.discordId,
      username: users.username,
      inGameName: users.inGameName,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  const [integration] = await db
    .select({ guildId: discordIntegrations.guildId })
    .from(discordIntegrations)
    .where(eq(discordIntegrations.factionId, factionId))
    .limit(1);

  const out: UnpingableMember[] = [];
  for (const row of rows) {
    const name = row.inGameName ?? row.username;
    if (!integration) continue;

    // null means Discord could not be asked. Staying quiet beats warning
    // about a tag that is probably fine.
    const present = await guildMemberExists(integration.guildId, row.discordId);
    if (present === false) {
      out.push({ userId: row.id, name, reason: 'not_in_server' });
    }
  }

  return out;
}

async function mentionableMembers(factionId: string, userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return true;
  const rows = await db
    .select({ userId: factionMembers.userId })
    .from(factionMembers)
    .where(
      and(eq(factionMembers.factionId, factionId), inArray(factionMembers.userId, userIds)),
    );
  return rows.length === new Set(userIds).size;
}

/** The columns a create or edit writes, schedule fields included. */
function columnsFor(input: ReminderInput) {
  const schedule = scheduleFromInput(input);
  return {
    channelId: input.channelId,
    channelName: input.channelName ?? null,
    title: input.title || null,
    message: input.message,
    scheduleType: input.scheduleType,
    // The fields belonging to other schedule types are cleared rather than
    // left behind: a weekly reminder switched to monthly must not keep a set
    // of weekdays that would confuse anyone reading the row later.
    timeOfDay: input.scheduleType === 'once' ? null : input.timeOfDay ?? null,
    weekdays: input.scheduleType === 'weekly' ? input.weekdays ?? null : null,
    dayOfMonth: input.scheduleType === 'monthly' ? input.dayOfMonth ?? null : null,
    runAt: input.scheduleType === 'once' && input.runAt ? new Date(input.runAt) : null,
    // Empty arrays are stored as null so "nobody is pinged" has one
    // representation rather than two.
    mentionRoleIds: input.mentionRoleIds?.length ? input.mentionRoleIds : null,
    mentionUserIds: input.mentionUserIds?.length ? input.mentionUserIds : null,
    isEnabled: input.isEnabled,
    // A disabled reminder has no pending run at all, which is what keeps it
    // out of the runner's query rather than relying on the flag alone.
    nextRunAt: input.isEnabled && schedule ? nextRun(schedule) : null,
  };
}

async function requireIntegration(factionId: string, res: Response): Promise<boolean> {
  const [integration] = await db
    .select({ id: discordIntegrations.id })
    .from(discordIntegrations)
    .where(eq(discordIntegrations.factionId, factionId))
    .limit(1);
  if (!integration) {
    error(res, 'NOT_FOUND', 'Connect a Discord server before scheduling reminders', 404);
    return false;
  }
  return true;
}

// ── GET / — every reminder this faction has ──────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const rows = await db
    .select()
    .from(discordReminders)
    .where(eq(discordReminders.factionId, factionId))
    // Pending ones first, soonest first; finished and disabled ones fall to
    // the bottom, which is where somebody scanning the list expects them.
    .orderBy(asc(discordReminders.nextRunAt), asc(discordReminders.createdAt));

  success(res, rows);
});

// ── POST / — schedule one ────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  if (!(await requireIntegration(factionId, res))) return;

  const parsed = reminderSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  if (!(await mentionableMembers(factionId, parsed.data.mentionUserIds ?? []))) {
    error(res, 'VALIDATION_ERROR', 'You can only tag members of this faction');
    return;
  }

  const count = await db.$count(discordReminders, eq(discordReminders.factionId, factionId));
  if (count >= MAX_REMINDERS) {
    error(res, 'VALIDATION_ERROR', `A faction can keep at most ${MAX_REMINDERS} reminders`);
    return;
  }

  const unpingable = await unpingableMembers(factionId, parsed.data.mentionUserIds ?? []);

  const [row] = await db
    .insert(discordReminders)
    .values({ factionId, createdBy: req.user!.id, ...columnsFor(parsed.data) })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'discord_reminder',
    entityId: row!.id,
    details: {
      channelId: parsed.data.channelId,
      scheduleType: parsed.data.scheduleType,
      title: parsed.data.title ?? null,
    },
    req,
  });

  success(res, { ...row, unpingable }, 201);
});

// ── PATCH /:reminderId — change one ──────────────────
router.patch('/:reminderId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const reminderId = req.params.reminderId as string;

  const [existing] = await db
    .select()
    .from(discordReminders)
    .where(and(eq(discordReminders.id, reminderId), eq(discordReminders.factionId, factionId)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Reminder not found', 404);
    return;
  }

  // A full replacement rather than a patch of individual fields. The schedule
  // fields only make sense as a set, and half-updating them is how a reminder
  // ends up weekly with a day-of-month and no weekdays.
  //
  // The row's unused schedule columns are null, and `.optional()` means absent
  // rather than null — so they are dropped before merging, leaving the request
  // body to supply whatever the new schedule type needs.
  const current = Object.fromEntries(
    Object.entries(existing).filter(([, value]) => value !== null),
  );
  const parsed = reminderSchema.safeParse({
    ...current,
    // The column is a Date; the schema takes an ISO string.
    ...(existing.runAt ? { runAt: existing.runAt.toISOString() } : {}),
    ...req.body,
  });
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  if (!(await mentionableMembers(factionId, parsed.data.mentionUserIds ?? []))) {
    error(res, 'VALIDATION_ERROR', 'You can only tag members of this faction');
    return;
  }

  const unpingable = await unpingableMembers(factionId, parsed.data.mentionUserIds ?? []);

  const [row] = await db
    .update(discordReminders)
    .set({ ...columnsFor(parsed.data), lastError: null, updatedAt: new Date() })
    .where(eq(discordReminders.id, reminderId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'discord_reminder',
    entityId: reminderId,
    details: { scheduleType: parsed.data.scheduleType, isEnabled: parsed.data.isEnabled },
    req,
  });

  success(res, { ...row, unpingable });
});

// ── DELETE /:reminderId ──────────────────────────────
router.delete('/:reminderId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const reminderId = req.params.reminderId as string;

  const [deleted] = await db
    .delete(discordReminders)
    .where(and(eq(discordReminders.id, reminderId), eq(discordReminders.factionId, factionId)))
    .returning();

  if (!deleted) {
    error(res, 'NOT_FOUND', 'Reminder not found', 404);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'discord_reminder',
    entityId: reminderId,
    details: { title: deleted.title, channelId: deleted.channelId },
    req,
  });

  success(res, { removed: true });
});

// ── POST /:reminderId/send — send it now ─────────────
// Not a test message: the real reminder, on demand. Useful for the one that
// was meant to go out an hour ago, and the only way to see what a reminder
// actually looks like without waiting until Friday.
router.post('/:reminderId/send', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const reminderId = req.params.reminderId as string;

  const [reminder] = await db
    .select()
    .from(discordReminders)
    .where(and(eq(discordReminders.id, reminderId), eq(discordReminders.factionId, factionId)))
    .limit(1);
  if (!reminder) {
    error(res, 'NOT_FOUND', 'Reminder not found', 404);
    return;
  }
  if (!(await requireIntegration(factionId, res))) return;

  // The same builder the scheduled run uses. A preview that differs from the
  // real thing is worse than no preview.
  const result = await postToChannel(reminder.channelId, await buildReminderMessage(reminder));
  await recordDeliveryOutcome(factionId, result);

  // Deliberately does not touch nextRunAt: sending one by hand is an extra,
  // not a replacement for the scheduled run.
  await db
    .update(discordReminders)
    .set({ lastRunAt: new Date(), lastError: result.ok ? null : result.error ?? 'Unknown error' })
    .where(eq(discordReminders.id, reminderId));

  success(res, result.ok ? { ok: true } : { ok: false, error: result.error });
});

export default router;
