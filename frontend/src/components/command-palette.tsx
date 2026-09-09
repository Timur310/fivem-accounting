'use client';

import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useAppStore, type AppView } from '@/lib/store';
import { membersApi } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';
import { displayName } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigable views with their label keys, pre-filtered for visibility. */
  views: { view: AppView; label: TranslationKey }[];
}

/**
 * Ctrl+K palette: jump to any view or member. Keyboard-first for the people
 * who live in the app, invisible for everyone else.
 */
export function CommandPalette({ open, onOpenChange, views }: Props) {
  const { t } = useTranslation();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedMemberUserId = useAppStore((s) => s.setSelectedMemberUserId);
  const factionId = useAppStore((s) => s.selectedFactionId);

  const { data: members = [] } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId!),
    enabled: open && !!factionId,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const go = (view: AppView) => {
    setCurrentView(view);
    onOpenChange(false);
  };
  const goProfile = (userId: string) => {
    setSelectedMemberUserId(userId);
    setCurrentView('member-profile');
    onOpenChange(false);
  };

  const memberItems = useMemo(() => members, [members]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <Command
        loop
        label={t('palette.placeholder')}
        className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-lg rounded-lg border border-white/[0.08] bg-[#101114] shadow-2xl shadow-black/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          autoFocus
          placeholder={t('palette.placeholder')}
          className="w-full bg-transparent px-4 h-12 text-sm text-zinc-200 outline-none border-b border-white/[0.06] placeholder:text-zinc-600"
        />
        <Command.List className="max-h-[320px] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-sm text-zinc-600">
            {t('palette.empty')}
          </Command.Empty>

          <Command.Group heading={t('palette.views')} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
            {views.map((v) => (
              <Command.Item
                key={v.view}
                value={`view ${t(v.label)}`}
                onSelect={() => go(v.view)}
                className="px-2.5 py-2 rounded-md text-sm text-zinc-300 cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-zinc-100"
              >
                {t(v.label)}
              </Command.Item>
            ))}
          </Command.Group>

          {memberItems.length > 0 && (
            <Command.Group heading={t('palette.members')} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
              {memberItems.map((m) => (
                <Command.Item
                  key={m.id}
                  value={`member ${displayName(m)} ${m.username}`}
                  onSelect={() => goProfile(m.userId)}
                  className="px-2.5 py-2 rounded-md text-sm text-zinc-300 cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-zinc-100"
                >
                  {displayName(m)}
                  {m.inGameName && <span className="ml-2 text-xs text-zinc-600">{m.username}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
