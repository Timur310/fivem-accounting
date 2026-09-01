'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi, apiErrorMessage } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';

/**
 * One-time prompt asking the player to set their in-game name.
 *
 * Shows when `user.inGameName === null` and the user hasn't dismissed the
 * prompt for this session. Save persists to /auth/me, Skip just hides the
 * dialog until next session (or until the user opens it again from settings).
 */
export function InGameNameModal() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const dismissed = useAppStore((s) => s.inGameNamePromptDismissed);
  const setDismissed = useAppStore((s) => s.setInGameNamePromptDismissed);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Open automatically the first time we have a user without an in-game name
  // who hasn't dismissed the prompt yet.
  useEffect(() => {
    if (user && user.inGameName === null && !dismissed) {
      setOpen(true);
    }
  }, [user, dismissed]);

  // Reset the input whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  if (!user) return null;

  const trimmed = value.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 50;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const updated = await authApi.updateMe({ inGameName: trimmed });
      setUser(updated);
      setDismissed(true);
      setOpen(false);
      toast({ title: t('inGameName.saved') });
    } catch (err) {
      toast({
        title: t('inGameName.saveFailed'),
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    setDismissed(true);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDismissed(true); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('inGameName.title')}</DialogTitle>
          <DialogDescription>{t('inGameName.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="in-game-name">{t('inGameName.label')}</Label>
          <Input
            id="in-game-name"
            autoFocus
            placeholder={t('inGameName.placeholder')}
            value={value}
            maxLength={50}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && !saving) handleSave();
            }}
          />
          <p className="text-xs text-zinc-500">{t('inGameName.fallbackHint')}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} disabled={saving}>
            {t('inGameName.skip')}
          </Button>
          <Button onClick={handleSave} disabled={!valid || saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
