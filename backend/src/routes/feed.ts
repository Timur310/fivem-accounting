import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { parsePagination } from '../lib/types.js';

/**
 * The faction timeline: everything that happened, newest first.
 *
 * **The feed is a view, never a back door.** Each source keeps the visibility
 * rule it has on its own screen, applied here as a WHERE clause rather than
 * left to the client:
 *
 * | source        | who sees it                                    |
 * |---------------|------------------------------------------------|
 * | entries       | every member (the ledger is open by design)     |
 * | announcements | every member                                    |
 * | payouts       | `manage_payouts`, else only your own            |
 * | strikes       | `manage_strikes`, else only your own            |
 * | joins/ranks   | `view_audit_logs` only                          |
 *
 * Without that, a member could read the whole faction's withdrawals and
 * everybody's discipline record through a screen that looks like a news feed —
 * the permission system would still be intact everywhere else and completely
 * bypassed here.
 *
 * **No rendered text is stored or returned.** §12.3.3 specified a
 * `summary` string per item; that cannot work in a bilingual interface, for
 * the same reason the notification bell stores a type and a data bag (§8.10).
 * A summary written in English at write time would be frozen in it. The client
 * renders `feed.<type>` through the i18n layer and interpolates `data`.
 */
const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const querySchema = z.object({
  page: z.string().optional(),
  page_size: z.string().optional(),
  type: z.enum(['entry', 'payout', 'announcement', 'strike', 'member_join', 'rank_change']).optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }
  const { page, pageSize, offset } = parsePagination(query.data);
  const perms = req.factionPermissions ?? [];
  const canSeeAllPayouts = perms.includes('manage_payouts');
  const canSeeAllStrikes = perms.includes('manage_strikes');
  const canSeeAudit = perms.includes('view_audit_logs');
  const me = req.user!.id;
  const typeFilter = query.data.type ?? null;

  // Each branch produces the same six columns so the UNION lines up:
  // id, type, created_at, actor_user_id, actor fields, data.
  //
  // `data` is jsonb rather than a rendered sentence — see the note above.
  const parts: ReturnType<typeof sql>[] = [];

  parts.push(sql`
    SELECT e.id::text AS id, 'entry' AS type, e.created_at AS created_at,
           u.id AS actor_id, u.username AS actor_username,
           u.in_game_name AS actor_in_game_name, u.avatar_url AS actor_avatar_url,
           u.is_system AS actor_is_system,
           jsonb_build_object(
             'amount', e.amount::text,
             'itemTypeName', it.name,
             'itemUnit', it.unit,
             'itemIsCurrency', it.is_currency,
             'itemIcon', it.icon,
             'itemCategory', it.category
           ) AS data
    FROM entries e
    JOIN users u ON u.id = e.user_id
    JOIN item_types it ON it.id = e.item_type_id
    WHERE e.faction_id = ${factionId} AND e.is_deleted = false
  `);

  parts.push(sql`
    SELECT a.id::text, 'announcement', a.created_at,
           u.id, u.username, u.in_game_name, u.avatar_url, u.is_system,
           jsonb_build_object('title', a.title, 'priority', a.priority)
    FROM announcements a
    JOIN users u ON u.id = a.author_id
    WHERE a.faction_id = ${factionId} AND a.is_deleted = false
  `);

  parts.push(sql`
    SELECT p.id::text, 'payout', p.created_at,
           u.id, u.username, u.in_game_name, u.avatar_url, u.is_system,
           jsonb_build_object(
             'amount', p.amount::text,
             'status', p.status,
             'itemTypeName', it.name,
             'itemUnit', it.unit,
             'itemIsCurrency', it.is_currency,
             'itemIcon', it.icon,
             'itemCategory', it.category
           )
    FROM payouts p
    JOIN users u ON u.id = p.recipient_user_id
    JOIN item_types it ON it.id = p.item_type_id
    WHERE p.faction_id = ${factionId} AND p.is_deleted = false
      ${canSeeAllPayouts ? sql`` : sql`AND p.recipient_user_id = ${me}`}
  `);

  parts.push(sql`
    SELECT s.id::text, 'strike', s.created_at,
           u.id, u.username, u.in_game_name, u.avatar_url, u.is_system,
           jsonb_build_object('severity', s.severity, 'status', s.status)
    FROM strikes s
    JOIN users u ON u.id = s.target_user_id
    WHERE s.faction_id = ${factionId}
      ${canSeeAllStrikes ? sql`` : sql`AND s.target_user_id = ${me}`}
  `);

  // Joins and rank changes have no table of their own — they are audit rows.
  // Reading them is exactly what `view_audit_logs` governs, so the whole
  // branch is omitted for anyone without it rather than filtered.
  if (canSeeAudit) {
    parts.push(sql`
      SELECT al.id::text, 'member_join', al.created_at,
             u.id, u.username, u.in_game_name, u.avatar_url, u.is_system,
             jsonb_build_object()
      FROM audit_logs al
      JOIN users u ON u.id = al.user_id
      WHERE al.faction_id = ${factionId}
        AND al.entity_type = 'member' AND al.action = 'create'
    `);

    parts.push(sql`
      SELECT al.id::text, 'rank_change', al.created_at,
             u.id, u.username, u.in_game_name, u.avatar_url, u.is_system,
             jsonb_build_object('rank', al.details -> 'after' ->> 'rank')
      FROM audit_logs al
      JOIN users u ON u.id = al.user_id
      WHERE al.faction_id = ${factionId}
        AND al.entity_type = 'member' AND al.action = 'update'
        AND al.details -> 'after' ? 'rank'
    `);
  }

  const unioned = sql.join(parts, sql` UNION ALL `);
  const filtered = typeFilter
    ? sql`SELECT * FROM (${unioned}) AS feed WHERE feed.type = ${typeFilter}`
    : sql`SELECT * FROM (${unioned}) AS feed`;

  // Wrapped because this router hand-writes its SQL, and Express 4 does not
  // catch a rejected promise from an async handler: without this the request
  // simply never answers, which is a far worse failure than a 500 — the
  // caller waits, the connection sits open, and nothing is logged.
  let rows: unknown;
  let countRows: unknown;
  try {
    [rows, countRows] = await Promise.all([
      db.execute(sql`
        ${filtered}
        ORDER BY created_at DESC, id DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM (${filtered}) AS counted`),
    ]);
  } catch (err) {
    console.error('[FEED ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to load the activity feed', 500);
    return;
  }

  const items = (rows as unknown as { rows: Record<string, unknown>[] }).rows ?? rows;
  const counted = (countRows as unknown as { rows: { count: number }[] }).rows ?? countRows;

  success(
    res,
    (items as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      type: r.type,
      createdAt: r.created_at,
      actorId: r.actor_id,
      actorUsername: r.actor_username,
      actorInGameName: r.actor_in_game_name,
      actorAvatarUrl: r.actor_avatar_url,
      // The placeholder that carries anonymous entries and both sides of a
      // laundering run. The client names it "the faction" rather than
      // printing a username nobody chose.
      actorIsSystem: r.actor_is_system,
      data: r.data ?? {},
    })),
    200,
    { page, page_size: pageSize, total_count: (counted as { count: number }[])[0]?.count ?? 0 },
  );
});

export default router;
