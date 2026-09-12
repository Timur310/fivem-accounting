import type { SupportTicketStatus } from './api-types';
import type { TranslationKey } from './i18n';

/**
 * One place for how a ticket status looks and reads, shared by the reporter's
 * page and the maintainer's inbox — the two must never disagree about what
 * "declined" looks like.
 *
 * Colour follows the §9.3 rule: it means an outcome or nothing. Green is
 * resolved, red is declined, neutral grey is cancelled (the reporter walked
 * away, which is not a failure), and open wears the plain amber of something
 * still waiting.
 */
export const STATUS_STYLES: Record<SupportTicketStatus, string> = {
  open: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  resolved: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  declined: 'border-red-500/20 bg-red-500/10 text-red-300',
  cancelled: 'border-white/[0.08] bg-white/[0.03] text-zinc-400',
};

export const STATUS_LABELS: Record<SupportTicketStatus, TranslationKey> = {
  open: 'support.statusOpen',
  resolved: 'support.statusResolved',
  declined: 'support.statusDeclined',
  cancelled: 'support.statusCancelled',
};
