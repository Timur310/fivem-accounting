'use client';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void; }) {
  useEffect(() => { console.error('[App Error]', error); }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-500/70 mb-4" />
      <h2 className="text-lg font-medium text-zinc-200 mb-2">Something went wrong</h2>
      <p className="text-sm text-zinc-500 max-w-md mb-6">
        An unexpected error occurred while rendering this view. You can try again — if the problem persists, please refresh the page or sign out and back in.
      </p>
      {error.digest && <p className="text-[11px] text-zinc-600 mb-4 font-mono">Error ID: {error.digest}</p>}
      <div className="flex gap-2">
        <Button onClick={reset} size="sm">Try again</Button>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    </div>
  );
}
