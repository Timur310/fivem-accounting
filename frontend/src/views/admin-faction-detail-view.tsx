'use client';

import { useQuery } from '@tanstack/react-query';
import { factionsApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Users, Package, Settings } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { Member, ItemType } from '@/lib/api-types';

export function AdminFactionDetailView() {
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
    return (
      <div className="text-center py-12 text-muted-foreground">
        Faction not found.
      </div>
    );
  }

  const goToDashboard = () => {
    setSelectedFactionId(data.id);
    setCurrentView('dashboard');
  };

  const goToMembers = () => {
    setSelectedFactionId(data.id);
    setCurrentView('members');
  };

  const goToSettings = () => {
    setSelectedFactionId(data.id);
    setCurrentView('settings');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setCurrentView('admin-factions')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold">{data.name}</h2>
          {data.description && (
            <p className="text-muted-foreground mt-1">{data.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Badge variant={data.isActive ? 'default' : 'secondary'}>
              {data.isActive ? 'Active' : 'Inactive'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Created {new Date(data.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={goToDashboard}>
          <Settings className="mr-2 h-4 w-4" />
          Open Dashboard
        </Button>
        <Button variant="outline" onClick={goToMembers}>
          <Users className="mr-2 h-4 w-4" />
          Manage Members
        </Button>
        <Button variant="outline" onClick={goToSettings}>
          <Package className="mr-2 h-4 w-4" />
          Edit Item Types
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Members List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Members ({data.members.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.members.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-6">No members.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.members.map((m: Member) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={m.avatarUrl ?? undefined} />
                      <AvatarFallback>{m.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.username}</p>
                      <p className="text-xs text-muted-foreground font-mono">{m.discordId}</p>
                    </div>
                    <Badge variant={m.role === 'admin' ? 'default' : 'secondary'} className="text-xs">
                      {m.role}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Item Types */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              Item Types ({data.itemTypes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.itemTypes.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-6">No item types.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.itemTypes.map((t: ItemType) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">Unit: {t.unit}</p>
                    </div>
                    <Badge variant={t.isActive ? 'default' : 'secondary'} className="text-xs">
                      {t.isActive ? 'Active' : 'Disabled'}
                    </Badge>
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
