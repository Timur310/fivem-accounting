'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/providers/i18n-provider';

/**
 * Route-level error boundary. Catches render errors anywhere below the
 * app router's root layout so a single broken view doesn't blank the
 * whole app — the user sees a "Something went wrong" panel with a retry
 * button that resets the boundary.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    // Noop for now — surface in dev only via the visible panel.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('Route error:', error);
    }
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-medium text-zinc-200">{t('error.title')}</h2>
      <p className="text-sm text-zinc-500 max-w-md">{t('error.body')}</p>
      {process.env.NODE_ENV !== 'production' && (
        <pre className="text-[11px] text-zinc-600 max-w-2xl overflow-x-auto whitespace-pre-wrap break-words">
          {error.message}
          {error.digest ? `\n\nDigest: ${error.digest}` : ''}
        </pre>
      )}
      <Button onClick={reset} size="sm">
        {t('error.tryAgain')}
      </Button>
    </div>
  );
}
