'use client';

import { useState } from 'react';
import { authApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Shield } from 'lucide-react';

interface LoginPageProps { onLogin: () => void; }

export function LoginPage({ onLogin }: LoginPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDiscordLogin = () => {
    setLoading(true);
    setError(null);
    window.location.href = authApi.getDiscordLoginUrl();
  };

  return (
    <div className="min-h-screen flex items-center justify-center dot-grid p-4">
      {/* Ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-[var(--brand-color,#6366f1)]/[0.06] rounded-full blur-[120px] pointer-events-none" />
      
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-color,#6366f1)]/10 border border-[var(--brand-color,#6366f1)]/20 mb-4">
            <Shield className="h-7 w-7" style={{ color: 'var(--brand-color, #6366f1)' }} />
          </div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">Faction Accountant</h1>
          <p className="text-sm text-zinc-500 mt-1.5 text-center">
            FiveM RP faction financial tracking.
            <br />Sign in with Discord to continue.
          </p>
        </div>

        <Button
          className="w-full h-11"
          onClick={handleDiscordLogin}
          disabled={loading}
          style={{ backgroundColor: '#5865F2', color: 'white' }}
        >
          <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
          </svg>
          {loading ? 'Redirecting...' : 'Continue with Discord'}
        </Button>

        {error && <p className="text-center text-sm text-red-400 mt-3">{error}</p>}
        <p className="text-center text-[11px] text-zinc-600 mt-3">
          You will be redirected to Discord to authorize access.
        </p>
      </div>
    </div>
  );
}
