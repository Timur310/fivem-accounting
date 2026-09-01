'use client';

import { useQuery } from '@tanstack/react-query';
import { factionsApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Users, Package, Settings } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { Member, ItemType } from '@/lib/api-types';
import { formatDate } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';

export function AdminFactionDetailView() {
  const { t } = useTranslation();
  const adminDetailFactionId = useAppStore((s) => s.adminDetailFactionId);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-faction-detail', adminDetailFactionId],
    queryFn: () => factionsApi.get(adminDetailFactionId!),
    enabled: !!adminDetailFactionId,
    staleTime: 30 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
          <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (!data) {
    return (<div className="text-center py-12 text-zinc-500"><p>{t('admin.factionNotFound')}</p></div>);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="text-zinc-500" onClick={() => setCurrentView('admin-factions')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-medium tracking-tight text-zinc-100">{data.name}</h2>
          {data.description && (<p className="text-zinc-500 mt-1 text-sm">{data.description}</p>)}
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${data.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/[0.04] text-zinc-500 border-white/[0.06]'}`}>
              {data.isActive ? t('common.active') : t('common.inactive')}
            </span>
            <span className="text-[11px] text-zinc-600 tabular-nums">{t('common.createdOn', { date: formatDate(data.createdAt) })}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => { setSelectedFactionId(data.id); setCurrentView('dashboard'); }}>
          <Settings className="mr-1.5 h-4 w-4" />{t('admin.openDashboard')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setSelectedFactionId(data.id); setCurrentView('members'); }}>
          <Users className="mr-1.5 h-4 w-4" />{t('admin.manageMembers')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setSelectedFactionId(data.id); setCurrentView('settings'); }}>
          <Package className="mr-1.5 h-4 w-4" />{t('admin.editItemTypes')}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-200 flex items-center gap-2"><Users className="h-4 w-4 text-zinc-400" />{t('nav.members')} ({data.members.length})</CardTitle></CardHeader>
          <CardContent>
            {data.members.length === 0 ? (<p className="text-zinc-600 text-sm text-center py-6">{t('members.none')}</p>) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {data.members.map((m: Member) => (
                  <div key={m.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                    <Avatar className="h-7 w-7"><AvatarImage src={m.avatarUrl ?? undefined} /><AvatarFallback className="text-[10px]">{m.username.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0"><p className="text-sm text-zinc-300 truncate">{m.username}</p><p className="text-[11px] text-zinc-600 font-mono tabular-nums">{m.discordId}</p></div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${m.role === 'admin' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-white/[0.04] text-zinc-500 border-white/[0.06]'}`}>{m.role === 'admin' ? t('role.admin') : t('role.member')}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-200 flex items-center gap-2"><Package className="h-4 w-4 text-zinc-400" />{t('settings.itemTypes')} ({data.itemTypes.length})</CardTitle></CardHeader>
          <CardContent>
            {data.itemTypes.length === 0 ? (<p className="text-zinc-600 text-sm text-center py-6">{t('itemTypes.none')}</p>) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {data.itemTypes.map((item: ItemType) => (
                  <div key={item.id} className="flex items-center justify-between py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                    <div><p className="text-sm text-zinc-300">{item.name}</p><p className="text-[11px] text-zinc-600">{t('itemTypes.unitLabel')}: {item.unit}</p></div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${item.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/[0.04] text-zinc-500 border-white/[0.06]'}`}>{item.isActive ? t('common.active') : t('common.disabled')}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
