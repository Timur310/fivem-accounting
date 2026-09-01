'use client';
import { AlertTriangle } from 'lucide-react';
import { getActiveLocale, translate } from '@/lib/i18n';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void; }) {
  console.error('[Global Error]', error);
  // This boundary replaces the root layout, so `I18nProvider` is gone and
  // `useTranslation` would throw. The module-level active locale outlives it —
  // it was last written on the render that crashed — so the panel still comes
  // up in whatever language the user was reading.
  const locale = getActiveLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
    <html lang={locale}>
      <body style={{ margin: 0, background: '#09090b', color: '#e4e4e7', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
          <AlertTriangle color="#f59e0b" size={40} style={{ opacity: 0.7, marginBottom: 16 }} />
          <h2 style={{ fontSize: 18, fontWeight: 500, margin: '0 0 8px' }}>{t('error.fatalTitle')}</h2>
          <p style={{ fontSize: 14, color: '#71717a', maxWidth: 480, marginBottom: 24 }}>
            {t('error.fatalBody')}
          </p>
          {error.digest && <p style={{ fontSize: 11, color: '#52525b', marginBottom: 16, fontFamily: 'monospace' }}>{t('error.errorId')}: {error.digest}</p>}
          <button onClick={reset} style={{ background: '#3b82f6', color: 'white', padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14 }}>{t('error.tryAgain')}</button>
        </div>
      </body>
    </html>
  );
}
