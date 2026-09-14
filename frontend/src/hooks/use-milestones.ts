'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { milestonesFor, milestoneStorageKey, type MilestoneInput } from '@/lib/milestones';

/**
 * Celebrate a personal milestone the first time it is reached, and never again.
 *
 * Two rules do most of the work here.
 *
 * **The first run celebrates nothing.** Somebody who has been using this for
 * six months and opens it after an update has passed every threshold in the
 * list; firing five toasts at them would be noise pretending to be a reward.
 * With no stored record, everything currently true is written down as already
 * seen and nothing is shown. Only crossings that happen while somebody is
 * watching get a toast.
 *
 * **One at a time.** Logging a big first entry can cross the entry and the
 * money thresholds at once. Stacking toasts turns a moment into an alert
 * storm, so the rest are marked seen and the highest-value one is shown.
 *
 * The record is per member per faction in localStorage. It is a convenience,
 * not a fact worth a table: the worst a cleared browser can do is repeat a
 * congratulation once.
 */
export function useMilestones(
  factionId: string | null,
  userId: string | null,
  input: MilestoneInput | null,
): void {
  const { toast } = useToast();
  const { t } = useTranslation();
  // Within a session the effect can run on every refetch; this keeps it from
  // re-reading and re-writing storage for a state it has already handled.
  const lastHandled = useRef<string>('');

  useEffect(() => {
    if (!factionId || !userId || !input) return;

    const signature = `${factionId}:${userId}:${input.entryCount}:${input.currencyContributed}:${input.streakCurrent}`;
    if (lastHandled.current === signature) return;
    lastHandled.current = signature;

    const key = milestoneStorageKey(factionId, userId);
    const current = milestonesFor(input);
    if (current.length === 0) return;

    let seen: string[] | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      seen = raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      // Private windows, blocked site data, malformed JSON from an older
      // shape. Treating it as "no record" is the safe read; the write below
      // is guarded too, so a browser that refuses storage simply never
      // celebrates rather than celebrating on every load.
      seen = null;
    }

    const firstRun = seen === null;
    const known = new Set(seen ?? []);
    const fresh = current.filter((m) => !known.has(m.id));

    try {
      window.localStorage.setItem(key, JSON.stringify(current.map((m) => m.id)));
    } catch {
      // Nothing to do. Without a record we would congratulate on every load,
      // so bail out rather than show anything.
      return;
    }

    if (firstRun || fresh.length === 0) return;

    // Biggest number wins when several land together.
    const best = fresh.reduce((a, b) => (b.value > a.value ? b : a));
    toast({
      title: t(best.titleKey, { count: best.value, value: best.value.toLocaleString() }),
      description: t(best.bodyKey, { count: best.value, value: best.value.toLocaleString() }),
    });
  }, [factionId, userId, input, toast, t]);
}
