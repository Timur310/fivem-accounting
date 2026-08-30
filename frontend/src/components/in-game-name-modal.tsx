'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { authApi, apiErrorMessage } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { User } from 'lucide-react';

/**
 * One-time prompt for the player's in-game character name.
 *
 * - Shows when the user is logged in but `user.inGameName === null` AND the
 *   prompt hasn't been dismissed this session.
 * - Player can enter a name (2-50 chars) and Save, OR click "Skip for now"
 *   to dismiss without setting one (the UI then falls back to the Discord
 *   username via `displayName()`).
 * - The modal re-appears next session if the player skipped — `null` is the
 *   signal that they haven't actually answered yet.
 *
 * The Save button calls PATCH /auth/me. On success it updates the user in
 * the store so the rest of the UI immediately reflects the new name.
 */
export function InGameNameModal() {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const dismissed = useAppStore((s) => s.inGameNamePromptDismissed);
  const setDismissed = useAppStore((s) => s.setInGameNamePromptDismissed);
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const open = !!user && user.inGameName === null && !dismissed;

  // Reset the input when the modal opens.
  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      toast({ title: 'Name too short', description: 'In-game name must be at least 2 characters.', variant: 'destructive' });
      return;
    }
    if (trimmed.length > 50) {
      toast({ title: 'Name too long', description: 'In-game name must be at most 50 characters.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const updated = await authApi.updateMe({ inGameName: trimmed });
      setUser(updated);
      setDismissed(true);
      toast({ title: 'Welcome!', description: `Your in-game name is set to "${trimmed}".` });
    } catch (err) {
      toast({ title: 'Failed to save', description: apiErrorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    // Dismiss for this session — the modal will reappear next login since
    // inGameName is still null. The UI falls back to the Discord username.
    setDismissed(true);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleSkip(); }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
              <User className="h-4 w-4 text-blue-400" />
            </div>
            <DialogTitle>What's your in-game name?</DialogTitle>
          </div>
          <DialogDescription>
            Players in FiveM are known by their character name, not their Discord handle. Set yours so the rest of the faction sees the right name. You can change this later from your profile.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="in-game-name">In-game name</Label>
          <Input
            id="in-game-name"
            placeholder="e.g. Marcus Reed"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={50}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && !saving) handleSave(); }}
          />
          <p className="text-[11px] text-zinc-500">
            Discord handle: <span className="text-zinc-400">{user?.username}</span>
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={handleSkip} disabled={saving}>
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={saving || value.trim().length < 2}>
            {saving ? 'Saving...' : 'Save name'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
