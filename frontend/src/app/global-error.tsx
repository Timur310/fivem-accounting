'use client';
import { AlertTriangle } from 'lucide-react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void; }) {
  console.error('[Global Error]', error);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#09090b', color: '#e4e4e7', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
          <AlertTriangle color="#f59e0b" size={40} style={{ opacity: 0.7, marginBottom: 16 }} />
          <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 8px' }}>Application error</h2>
          <p style={{ fontSize: 14, color: '#71717a', maxWidth: 480, marginBottom: 24 }}>
            A critical error occurred and the application cannot continue. Please reload the page.
          </p>
          {error.digest && <p style={{ fontSize: 11, color: '#52525b', marginBottom: 16, fontFamily: 'monospace' }}>Error ID: {error.digest}</p>}
          <button onClick={reset} style={{ background: '#3b82f6', color: 'white', padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
