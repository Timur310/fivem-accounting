import type { FactionMembership, FactionPermission } from '@/lib/api-types';
import type { AppView } from '@/lib/store';

/**
 * Permissions that mean someone looks after the faction as a whole, and so
 * starts their evening on the dashboard's overview. Anybody holding none of
 * them is here to play, and starts on My day.
 */
const OVERSEEING: FactionPermission[] = [
  'manage_members',
  'manage_settings',
  'view_reports',
  'manage_payouts',
];

/**
 * The first screen after signing in to a faction.
 *
 * The dashboard answers leadership's questions — the treasury, the board, the
 * week's contributors. A plain member opening the app wants to know about
 * *themselves*: their shift, their quota, their unread announcements. So they
 * land on My day, and leadership keeps landing where it always has.
 */
export function homeViewFor(membership: FactionMembership | undefined): AppView {
  if (!membership) return 'dashboard';
  if (membership.role === 'admin') return 'dashboard';
  return membership.permissions.some((p) => OVERSEEING.includes(p)) ? 'dashboard' : 'my-day';
}
