import { db, type TransactionLike } from '../db/index.js';
import { notifications, type NotificationType } from '../db/schema.js';

/**
 * Raise a notification for one person.
 *
 * Stores a `type` and a `data` bag, never rendered text — the interface is
 * bilingual and a member can switch language at any time, so a sentence
 * written in English when the event fired would be stuck that way forever.
 *
 * **Never throws.** A notification is a courtesy attached to something that
 * already happened: the payout really was approved, the strike really was
 * issued. Letting a failed insert roll that back — or 500 the request that
 * caused it — would trade a real outcome for a nicety. Failures are logged and
 * swallowed.
 *
 * Pass `tx` when the caller is inside a transaction that has *not* committed
 * yet and the notification should share its fate; omit it to write
 * independently, which is the safer default for anything raised after the
 * work is already durable.
 */
export async function notify(params: {
  userId: string;
  type: NotificationType;
  factionId?: string | null;
  data?: Record<string, string | number | null>;
  linkView?: string | null;
  tx?: TransactionLike;
}): Promise<void> {
  const { userId, type, factionId = null, data, linkView = null, tx } = params;

  try {
    await (tx ?? db).insert(notifications).values({
      userId,
      factionId,
      type,
      data: data ?? null,
      linkView,
    });
  } catch (err) {
    console.error('[NOTIFY ERROR]', type, err);
  }
}

/**
 * Raise the same notification for several people at once.
 *
 * `actorId` is dropped from the list: telling someone they did the thing they
 * just did is noise, and it is the single most common way a notification
 * feature becomes something people switch off.
 */
export async function notifyMany(params: {
  userIds: string[];
  actorId?: string;
  type: NotificationType;
  factionId?: string | null;
  data?: Record<string, string | number | null>;
  linkView?: string | null;
  tx?: TransactionLike;
}): Promise<void> {
  const { userIds, actorId, ...rest } = params;
  const recipients = [...new Set(userIds)].filter((id) => id !== actorId);
  if (recipients.length === 0) return;

  try {
    await (rest.tx ?? db).insert(notifications).values(
      recipients.map((userId) => ({
        userId,
        factionId: rest.factionId ?? null,
        type: rest.type,
        data: rest.data ?? null,
        linkView: rest.linkView ?? null,
      })),
    );
  } catch (err) {
    console.error('[NOTIFY MANY ERROR]', rest.type, err);
  }
}
