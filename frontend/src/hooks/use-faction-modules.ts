'use client';

import { useQuery } from '@tanstack/react-query';
import { factionSettingsApi } from '@/lib/api-client';
import { isModuleEnabled, type FactionModule } from '@/lib/api-types';

/**
 * Which parts of the app this faction uses.
 *
 * The navigation filters itself, but a module's tools are not only on that
 * module's screen: the dashboard has a quick-log box that writes an entry, a
 * quota strip, a contributor board. A faction that switched entries off would
 * still see the box, and pressing it would earn a 403 from a server that has
 * been told the faction does not do this any more.
 *
 * Shares the settings query the rest of the app already makes, so asking costs
 * nothing extra. While that query is in flight `isOn` answers true: a screen
 * that flashed its panels away half a second after loading would be worse than
 * one that shows them, and modules are a preference rather than a permission.
 */
export function useFactionModules(factionId: string | null) {
  const { data } = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId!),
    enabled: !!factionId,
  });

  return {
    isOn: (module: FactionModule) => isModuleEnabled(data?.enabledModules, module),
    /** Null until the settings arrive, and null means every module. */
    enabledModules: data?.enabledModules ?? null,
  };
}
