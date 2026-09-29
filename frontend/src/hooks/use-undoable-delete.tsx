'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { apiErrorMessage } from '@/lib/api-client';
import { useTranslation } from '@/providers/i18n-provider';

/** How long a delete can still be taken back. */
const UNDO_MS = 5000;

/**
 * Delete now, with a few seconds to take it back — instead of asking first.
 *
 * "Are you sure?" is a question people learn to click through, so it protects
 * nobody by the second week, and it costs a click on every delete that was
 * meant. This hides the item at once and shows "Deleted · Undo"; the request
 * goes to the server only when the time runs out. Nothing new is needed on
 * the server, because nothing has happened there yet when Undo is pressed.
 *
 * The toast area holds one toast at a time, so several deletes in a row share
 * it: it counts them, and Undo brings all of them back.
 *
 * Leaving the screen before the time is up sends the delete straight away —
 * that is what was asked for. Closing the tab does not, and the delete simply
 * does not happen: the safe way for it to go wrong.
 *
 * Only for deletes that are cheap to be wrong about. Anything that moves money
 * or takes other rows with it keeps its confirmation.
 */
export function useUndoableDelete({
  run,
  onDone,
}: {
  /** The actual delete. */
  run: (id: string) => Promise<unknown>;
  /** After a delete has really gone through — usually a query invalidation. */
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const runRef = useRef(run);
  const doneRef = useRef(onDone);
  runRef.current = run;
  doneRef.current = onDone;

  const unhide = useCallback((ids: string[]) => {
    setHidden((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(async (id: string) => {
    pending.current.delete(id);
    try {
      await runRef.current(id);
      doneRef.current?.();
    } catch (err) {
      // The server said no after all — a held entry, a lost connection. Put
      // it back where it was and say why, rather than leave it vanished.
      unhide([id]);
      toast({ title: t('undo.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    }
  }, [t, unhide]);

  const undoAll = useCallback(() => {
    const ids = [...pending.current.keys()];
    for (const timer of pending.current.values()) clearTimeout(timer);
    pending.current.clear();
    unhide(ids);
  }, [unhide]);

  const request = useCallback((id: string) => {
    setHidden((current) => new Set(current).add(id));
    pending.current.set(id, setTimeout(() => void commit(id), UNDO_MS));

    const count = pending.current.size;
    toast({
      title: count === 1 ? t('undo.deletedOne') : t('undo.deletedMany', { count }),
      duration: UNDO_MS,
      action: (
        <ToastAction altText={t('undo.undo')} onClick={undoAll}>
          {t('undo.undo')}
        </ToastAction>
      ),
    });
  }, [commit, t, undoAll]);

  // Leaving the screen is not a change of mind: whatever was deleted goes now.
  useEffect(() => () => {
    for (const [id, timer] of pending.current) {
      clearTimeout(timer);
      void runRef.current(id).then(() => doneRef.current?.(), () => undefined);
    }
    pending.current.clear();
  }, []);

  return { request, hidden };
}
