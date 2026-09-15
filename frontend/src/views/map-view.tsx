'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type * as L from 'leaflet';
import { mapApi, factionSettingsApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ErrorState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MapPin, Route, Hexagon, Trash2, Pencil, Lock, X, Check, Plus, Layers, Eye, EyeOff,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { cn } from '@/lib/utils';
import {
  MAP_THEMES, MAP_THEME_STORAGE_KEY, MAP_MAX_ZOOM, MAP_TILE_SIZE, MAP_IMAGE_SIZE,
  gameToPixel, pixelToGame, formatGamePoint, parseGamePoint, type GamePoint,
} from '@/lib/gta-map';
import type {
  MapMarker, MapMarkerKind, MapMarkerInput, MapLayer, MapLayerInput,
} from '@/lib/api-types';

interface Props {
  factionId: string;
  canManage: boolean;
}

/** What the map is waiting for the next click to mean. */
type DrawMode = null | MapMarkerKind;

/**
 * The faction's map.
 *
 * Markers are stored in game coordinates and drawn through one transform in
 * `lib/gta-map.ts`. Leaflet is used with `CRS.Simple`, which is the flat
 * pixel-space projection — the GTA world is not a globe and running it through
 * a spherical Mercator would bend every straight road.
 *
 * Leaflet is mounted imperatively in an effect rather than through a React
 * wrapper. It owns its own DOM and its own event loop, and letting React
 * re-render into it is how you get duplicated layers and leaked handlers.
 */
export function MapView({ factionId, canManage }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);

  const [ready, setReady] = useState(false);
  // Read once, lazily, so the server render and the first client render agree
  // — reading localStorage during render is a hydration mismatch waiting to
  // happen. An unknown or missing id falls back to the first theme.
  const [themeId, setThemeId] = useState(MAP_THEMES[0]!.id);
  const [hover, setHover] = useState<GamePoint | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawn, setDrawn] = useState<GamePoint[]>([]);
  const [editing, setEditing] = useState<MapMarker | null>(null);
  const [pending, setPending] = useState<MapMarkerInput | null>(null);
  const [deleting, setDeleting] = useState<MapMarker | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingLayer, setEditingLayer] = useState<MapLayer | 'new' | null>(null);
  const [deletingLayer, setDeletingLayer] = useState<MapLayer | null>(null);
  /** Which maps are currently drawn. Absent means shown — everything starts on. */
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  /** Where the next marker goes. */
  const [targetLayerId, setTargetLayerId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MAP_THEME_STORAGE_KEY);
      if (stored && MAP_THEMES.some((theme) => theme.id === stored)) setThemeId(stored);
    } catch {
      // Private windows and blocked site data. The default theme is a fine
      // answer; nothing here is worth failing over.
    }
  }, []);

  const layersQuery = useQuery({
    queryKey: ['map-layers', factionId],
    queryFn: () => mapApi.layers(factionId),
  });

  const markersQuery = useQuery({
    queryKey: ['map-markers', factionId],
    queryFn: () => mapApi.list(factionId),
  });

  const settingsQuery = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
    enabled: canManage,
  });

  const layers = useMemo(() => layersQuery.data?.layers ?? [], [layersQuery.data]);
  const allMarkers = useMemo(() => markersQuery.data?.markers ?? [], [markersQuery.data]);
  // Hidden layers are a view setting, not a permission: the server already
  // withheld anything this viewer may not open.
  const markers = useMemo(
    () => allMarkers.filter((m) => !hiddenLayers.has(m.layerId)),
    [allMarkers, hiddenLayers],
  );
  const layerById = useMemo(
    () => new Map(layers.map((l) => [l.id, l])),
    [layers],
  );

  // The first map is the default target, and the target follows the list if
  // the one being drawn on is deleted.
  useEffect(() => {
    if (layers.length === 0) {
      setTargetLayerId(null);
      return;
    }
    if (!targetLayerId || !layers.some((l) => l.id === targetLayerId)) {
      setTargetLayerId(layers[0]!.id);
    }
  }, [layers, targetLayerId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['map-markers', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['map-layers', factionId] });
  };

  const save = useMutation({
    mutationFn: (input: MapMarkerInput) =>
      editing ? mapApi.update(factionId, editing.id, input) : mapApi.create(factionId, input),
    onSuccess: () => {
      setPending(null);
      setEditing(null);
      setDrawn([]);
      setDrawMode(null);
      invalidate();
      toast({ title: t('map.saved') });
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const saveLayer = useMutation({
    mutationFn: (input: MapLayerInput) =>
      editingLayer && editingLayer !== 'new'
        ? mapApi.updateLayer(factionId, editingLayer.id, input)
        : mapApi.createLayer(factionId, input),
    onSuccess: () => {
      setEditingLayer(null);
      invalidate();
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const removeLayer = useMutation({
    mutationFn: (id: string) => mapApi.removeLayer(factionId, id),
    onSuccess: () => {
      setDeletingLayer(null);
      invalidate();
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => mapApi.remove(factionId, id),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  // ── mount the map once ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Imported here rather than at module scope: Leaflet touches `window` as
    // it loads, and this app prerenders its shell on the server.
    void import('leaflet').then((mod) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const leaflet = mod.default ?? mod;
      leafletRef.current = leaflet as unknown as typeof L;

      const map = leaflet.map(containerRef.current, {
        crs: leaflet.CRS.Simple,
        minZoom: 0,
        maxZoom: MAP_MAX_ZOOM,
        zoomControl: true,
        attributionControl: false,
      });

      // The image is square and CRS.Simple counts in pixels at zoom 0, so the
      // corners are the native size scaled down by the zoom range.
      const size = MAP_IMAGE_SIZE / 2 ** MAP_MAX_ZOOM;
      const bounds = leaflet.latLngBounds(
        leaflet.latLng(-size, 0),
        leaflet.latLng(0, size),
      );

      boundsRef.current = bounds;
      tileRef.current = leaflet.tileLayer(MAP_THEMES[0]!.url, {
        tileSize: MAP_TILE_SIZE,
        minZoom: 0,
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: MAP_THEMES[0]!.maxNativeZoom,
        noWrap: true,
        bounds,
      }).addTo(map);

      map.setMaxBounds(bounds.pad(0.2));
      map.fitBounds(bounds);

      layerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileRef.current = null;
    };
  }, []);

  // ── swap the tile layer when the style changes ──────
  //
  // The old layer is removed and a new one added rather than the URL being
  // rewritten in place: setUrl keeps the old tiles on screen until each
  // replacement loads, which on a slow connection is two styles blended
  // together for several seconds.
  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const bounds = boundsRef.current;
    if (!leaflet || !map || !bounds || !ready) return;

    const theme = MAP_THEMES.find((entry) => entry.id === themeId) ?? MAP_THEMES[0]!;
    if (tileRef.current) map.removeLayer(tileRef.current);

    tileRef.current = leaflet.tileLayer(theme.url, {
      tileSize: MAP_TILE_SIZE,
      minZoom: 0,
      maxZoom: MAP_MAX_ZOOM,
      maxNativeZoom: theme.maxNativeZoom,
      noWrap: true,
      bounds,
    });
    // Behind the markers, which live in their own layer group added later.
    tileRef.current.addTo(map);
    tileRef.current.bringToBack();
  }, [themeId, ready]);

  /** Leaflet's own units for a game coordinate, and back. */
  const toLatLng = (point: GamePoint): L.LatLng | null => {
    const map = mapRef.current;
    if (!map) return null;
    const [px, py] = gameToPixel(point);
    return map.unproject([px, py], MAP_MAX_ZOOM);
  };

  const fromLatLng = (latlng: L.LatLng): GamePoint => {
    const map = mapRef.current!;
    const pixel = map.project(latlng, MAP_MAX_ZOOM);
    return pixelToGame(pixel.x, pixel.y);
  };

  // ── the cursor says what the next click will do ──────
  //
  // Leaflet ships `.leaflet-crosshair` for this, including the rule that
  // covers markers underneath, so there is nothing to write but the toggle.
  //
  // Toggled through classList rather than React's className: Leaflet mutates
  // the class list of this same element for drag state and zoom animation, and
  // a React re-render setting className would wipe whatever it had added.
  useEffect(() => {
    const container = mapRef.current?.getContainer();
    if (!container) return;

    container.classList.toggle('leaflet-crosshair', drawMode !== null);
    return () => container.classList.remove('leaflet-crosshair');
  }, [drawMode, ready]);

  // ── the coordinate readout, and clicks while drawing ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onMove = (e: L.LeafletMouseEvent) => setHover(fromLatLng(e.latlng));
    const onClick = (e: L.LeafletMouseEvent) => {
      if (!drawMode) return;
      const point = fromLatLng(e.latlng);
      setDrawn((previous) => (drawMode === 'point' ? [point] : [...previous, point]));
    };

    map.on('mousemove', onMove);
    map.on('click', onClick);
    return () => {
      map.off('mousemove', onMove);
      map.off('click', onClick);
    };
  }, [ready, drawMode]);

  // ── redraw whenever the data or the draft changes ───
  useEffect(() => {
    const leaflet = leafletRef.current;
    const layer = layerRef.current;
    if (!leaflet || !layer || !ready) return;

    layer.clearLayers();

    // `var()` is fine here: Leaflet writes this into the SVG `stroke`
    // presentation attribute, and browsers resolve custom properties in those
    // against the element's inherited value. Checked, because the opposite is
    // widely repeated and would have meant every uncoloured line drawing with
    // no stroke at all.
    // Marker colour first, then the layer's, then the faction accent — so a
    // whole map can be recoloured in one place and an individual pin can still
    // stand out inside it.
    //
    // `var()` is fine here: Leaflet writes this into the SVG `stroke`
    // presentation attribute, and browsers resolve custom properties in those
    // against the element's inherited value. Checked, because the opposite is
    // widely repeated and would have meant every uncoloured line drawing with
    // no stroke at all.
    const accent = (marker: MapMarker) =>
      marker.color || layerById.get(marker.layerId)?.color || 'var(--brand-color, #6366f1)';

    for (const marker of markers) {
      const coords = marker.points
        .map(toLatLng)
        .filter((c): c is L.LatLng => c !== null);
      if (coords.length === 0) continue;

      const isSelected = selected === marker.id;
      // Leaflet's `weight` is screen pixels and does not grow with zoom, so a
      // line thin enough to look tidy zoomed out disappears into the map
      // detail zoomed in. These are the widths that stay readable at both
      // ends; a route is meant to be followed, not admired.
      const weight = marker.kind === 'route'
        ? (isSelected ? 8 : 6)
        : (isSelected ? 5 : 3);
      const style = {
        color: accent(marker),
        weight,
        opacity: isSelected ? 1 : 0.9,
        fillOpacity: isSelected ? 0.35 : 0.2,
        lineJoin: 'round' as const,
        lineCap: 'round' as const,
      };
      // A dark casing underneath, the way road maps draw roads. Without it a
      // bright line over bright ground — a desert, a runway — has no edge and
      // reads as a smear.
      const casing = {
        color: '#000',
        weight: weight + 4,
        opacity: 0.45,
        lineJoin: 'round' as const,
        lineCap: 'round' as const,
      };

      let shape: L.Layer;
      if (marker.kind === 'point') {
        shape = leaflet.marker(coords[0]!, {
          icon: leaflet.divIcon({
            className: '',
            html: `<div style="--pin:${accent(marker)}" class="map-pin${isSelected ? ' map-pin-on' : ''}">${marker.icon ?? ''}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        });
      } else if (marker.kind === 'route') {
        leaflet.polyline(coords, casing).addTo(layer);
        shape = leaflet.polyline(coords, style);
      } else {
        leaflet.polygon(coords, { ...casing, fill: false }).addTo(layer);
        shape = leaflet.polygon(coords, style);
      }

      shape.on('click', () => setSelected(marker.id));
      shape.bindTooltip(marker.name, { direction: 'top' });
      shape.addTo(layer);
    }

    // The shape being drawn right now, so it is visible as it is built.
    if (drawn.length > 0) {
      const coords = drawn.map(toLatLng).filter((c): c is L.LatLng => c !== null);
      const draftStyle = { color: '#f59e0b', weight: 2, dashArray: '4 4', fillOpacity: 0.15 };
      for (const c of coords) {
        leaflet.circleMarker(c, { radius: 4, color: '#f59e0b', fillOpacity: 1 }).addTo(layer);
      }
      if (drawMode === 'route' && coords.length > 1) {
        leaflet.polyline(coords, draftStyle).addTo(layer);
      }
      if (drawMode === 'area' && coords.length > 2) {
        leaflet.polygon(coords, draftStyle).addTo(layer);
      }
    }
  }, [markers, drawn, drawMode, selected, ready, layerById]);

  const startDraw = (kind: MapMarkerKind) => {
    setDrawMode(kind);
    setDrawn([]);
    setSelected(null);
  };

  const enoughDrawn =
    drawMode === 'point' ? drawn.length === 1
      : drawMode === 'route' ? drawn.length >= 2
        : drawn.length >= 3;

  const openEditorForDrawn = () => {
    if (!drawMode || !enoughDrawn || !targetLayerId) return;
    setEditing(null);
    setPending({ layerId: targetLayerId, kind: drawMode, name: '', points: drawn });
  };

  const ranks = useMemo(
    () => [...(settingsQuery.data?.ranks ?? [])].sort((a, b) => a.level - b.level),
    [settingsQuery.data],
  );

  const focus = (marker: MapMarker) => {
    const map = mapRef.current;
    const first = marker.points[0] && toLatLng(marker.points[0]);
    if (!map || !first) return;
    setSelected(marker.id);
    map.setView(first, Math.max(map.getZoom(), 3));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">{t('map.title')}</h1>
          <p className="text-meta text-zinc-500 mt-1 max-w-xl">{t('map.subtitle')}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {(['point', 'route', 'area'] as const).map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={drawMode === kind ? 'default' : 'outline'}
                // Nothing can be drawn before there is a map to draw it on.
                disabled={!targetLayerId}
                title={targetLayerId ? undefined : t('map.noLayersManage')}
                onClick={() => (drawMode === kind ? setDrawMode(null) : startDraw(kind))}
              >
                {kind === 'point' && <MapPin className="h-4 w-4" />}
                {kind === 'route' && <Route className="h-4 w-4" />}
                {kind === 'area' && <Hexagon className="h-4 w-4" />}
                {t(`map.kind.${kind}` as never)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {drawMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.04] px-3 py-2">
          <span className="text-xs text-amber-300">
            {t(`map.drawHint.${drawMode}` as never)}
            {drawn.length > 0 && ` · ${t('map.pointsPlaced', { count: drawn.length })}`}
            {targetLayerId && ` · ${t('map.drawingOnto', { layer: layerById.get(targetLayerId)?.name ?? '' })}`}
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setDrawMode(null); setDrawn([]); }}>
              <X className="h-3.5 w-3.5" />
              {t('common.cancel')}
            </Button>
            <Button size="sm" disabled={!enoughDrawn} onClick={openEditorForDrawn}>
              <Check className="h-3.5 w-3.5" />
              {t('map.finish')}
            </Button>
          </div>
        </div>
      )}

      {markersQuery.isError && (
        <ErrorState error={markersQuery.error} onRetry={() => void markersQuery.refetch()} />
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="relative">
          <div
            ref={containerRef}
            className="h-[calc(100vh-18rem)] min-h-[420px] w-full rounded-lg border border-[var(--line-2)] bg-[#0b1020]"
          />
          {!ready && <Skeleton className="absolute inset-0 rounded-lg" />}

          {MAP_THEMES.length > 1 && (
            <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-md border border-[var(--line-2)] bg-black/70 p-1">
              {MAP_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => {
                    setThemeId(theme.id);
                    try {
                      window.localStorage.setItem(MAP_THEME_STORAGE_KEY, theme.id);
                    } catch {
                      // Not remembering the choice is a smaller problem than
                      // refusing to make it.
                    }
                  }}
                  className={cn(
                    'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                    themeId === theme.id
                      ? 'bg-[var(--brand-color,#6366f1)] text-white'
                      : 'text-zinc-300 hover:bg-white/10',
                  )}
                >
                  {theme.label}
                </button>
              ))}
            </div>
          )}

          {/* The readout is how somebody checks the calibration without
              guessing: hover a place they know and compare the numbers. */}
          {hover && (
            <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/70 px-2 py-1 font-mono text-[11px] text-zinc-300">
              {formatGamePoint(hover)}
            </div>
          )}
        </div>

        <div className="space-y-2 lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto">
          <div className="rounded-md border border-[var(--line-2)] bg-[var(--fill-2)] p-2 space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-zinc-500" />
              <span className="text-micro font-medium text-zinc-300">{t('map.layers')}</span>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-6 px-2"
                  onClick={() => setEditingLayer('new')}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              )}
            </div>

            {layersQuery.isLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : layers.length === 0 ? (
              <p className="text-micro text-zinc-500 py-1">
                {canManage ? t('map.noLayersManage') : t('map.noLayers')}
              </p>
            ) : (
              layers.map((layer) => {
                const shown = !hiddenLayers.has(layer.id);
                const isTarget = targetLayerId === layer.id;
                return (
                  <div
                    key={layer.id}
                    className={cn(
                      'flex items-center gap-1.5 rounded px-1.5 py-1',
                      isTarget && canManage ? 'bg-[var(--fill-3)]' : '',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={shown ? t('map.hideLayer') : t('map.showLayer')}
                      onClick={() =>
                        setHiddenLayers((current) => {
                          const next = new Set(current);
                          if (next.has(layer.id)) next.delete(layer.id);
                          else next.add(layer.id);
                          return next;
                        })
                      }
                      className="shrink-0 text-zinc-500 hover:text-zinc-200"
                    >
                      {shown ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>

                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: layer.color || 'var(--brand-color, #6366f1)' }}
                    />

                    {/* Clicking the name aims the draw tools at that map, so
                        "which map am I adding to" is answered before anything
                        is drawn rather than in the dialog afterwards. */}
                    <button
                      type="button"
                      onClick={() => canManage && setTargetLayerId(layer.id)}
                      className={cn(
                        'min-w-0 flex-1 truncate text-left text-xs',
                        shown ? 'text-zinc-200' : 'text-zinc-600 line-through',
                      )}
                      title={layer.description ?? undefined}
                    >
                      {layer.name}
                      <span className="ml-1 text-zinc-600">{layer.markerCount}</span>
                    </button>

                    {layer.minRankLevel != null && (
                      <Lock className="h-3 w-3 shrink-0 text-amber-400" aria-label={t('map.restricted')} />
                    )}

                    {canManage && (
                      <span className="flex shrink-0 gap-1">
                        <Pencil
                          className="h-3 w-3 cursor-pointer text-zinc-600 hover:text-zinc-200"
                          onClick={() => setEditingLayer(layer)}
                        />
                        <Trash2
                          className="h-3 w-3 cursor-pointer text-zinc-600 hover:text-red-400"
                          onClick={() => setDeletingLayer(layer)}
                        />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {canManage && <PasteCoordinates onPlace={(p) => { setDrawMode('point'); setDrawn([p]); }} />}

          {markersQuery.isLoading
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)
            : markers.length === 0
              ? <p className="text-meta text-zinc-500 px-1">{t('map.none')}</p>
              : markers.map((marker) => (
                <button
                  key={marker.id}
                  onClick={() => focus(marker)}
                  className={cn(
                    'w-full rounded-md border p-2 text-left transition-colors',
                    selected === marker.id
                      ? 'border-[var(--brand-color,#6366f1)] bg-[var(--fill-3)]'
                      : 'border-[var(--line-2)] bg-[var(--fill-2)] hover:border-[var(--line-3)]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-100 truncate">
                      {marker.icon ? `${marker.icon} ` : ''}{marker.name}
                    </span>
                    {layerById.get(marker.layerId)?.minRankLevel != null && (
                      <Lock className="h-3 w-3 shrink-0 text-amber-400" aria-label={t('map.restricted')} />
                    )}
                    {canManage && (
                      <span className="ml-auto flex shrink-0 gap-1">
                        <Pencil
                          className="h-3.5 w-3.5 text-zinc-500 hover:text-zinc-200"
                          onClick={(e) => { e.stopPropagation(); setEditing(marker); setPending(toInput(marker)); }}
                        />
                        <Trash2
                          className="h-3.5 w-3.5 text-zinc-500 hover:text-red-400"
                          onClick={(e) => { e.stopPropagation(); setDeleting(marker); }}
                        />
                      </span>
                    )}
                  </div>
                  <p className="text-micro text-zinc-500 mt-0.5">
                    {t(`map.kind.${marker.kind}` as never)}
                    {marker.category ? ` · ${marker.category}` : ''}
                    {marker.points[0] ? ` · ${formatGamePoint(marker.points[0])}` : ''}
                  </p>
                </button>
              ))}
        </div>
      </div>

      {pending && (
        <MarkerEditor
          value={pending}
          isEdit={!!editing}
          layers={layers}
          saving={save.isPending}
          onCancel={() => { setPending(null); setEditing(null); }}
          onSave={(input) => save.mutate(input)}
        />
      )}

      {editingLayer && (
        <LayerEditor
          value={editingLayer === 'new'
            ? { name: '', minRankLevel: null }
            : {
              name: editingLayer.name,
              description: editingLayer.description ?? '',
              color: editingLayer.color ?? undefined,
              icon: editingLayer.icon ?? '',
              minRankLevel: editingLayer.minRankLevel,
            }}
          isEdit={editingLayer !== 'new'}
          ranks={ranks}
          saving={saveLayer.isPending}
          onCancel={() => setEditingLayer(null)}
          onSave={(input) => saveLayer.mutate(input)}
        />
      )}

      <AlertDialog open={!!deletingLayer} onOpenChange={(open) => !open && setDeletingLayer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('map.deleteLayerConfirm', { name: deletingLayer?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('map.deleteLayerBody', { count: deletingLayer?.markerCount ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingLayer && removeLayer.mutate(deletingLayer.id)}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('map.deleteConfirm', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('map.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Name a map, colour it, and decide which ranks can open it. */
function LayerEditor({
  value, isEdit, ranks, saving, onCancel, onSave,
}: {
  value: MapLayerInput;
  isEdit: boolean;
  ranks: { name: string; level: number }[];
  saving: boolean;
  onCancel: () => void;
  onSave: (input: MapLayerInput) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<MapLayerInput>(value);
  const patch = (next: Partial<MapLayerInput>) => setDraft((d) => ({ ...d, ...next }));

  const rankOptions = [
    { value: '', label: t('map.visibleToEveryone') },
    ...ranks.map((r) => ({
      value: String(r.level),
      label: t('map.visibleToRank', { rank: r.name }),
    })),
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('map.editLayer') : t('map.newLayer')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="layer-name">{t('map.name')}</Label>
            <Input
              id="layer-name"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('map.layerNamePlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="layer-description">{t('map.description')}</Label>
            <Textarea
              id="layer-description"
              rows={2}
              value={draft.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="layer-color">{t('map.color')}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="layer-color"
                  type="color"
                  value={draft.color ?? DEFAULT_MARKER_COLOR}
                  onChange={(e) => patch({ color: e.target.value })}
                  className="h-9 w-14 cursor-pointer rounded border border-[var(--line-2)] bg-transparent"
                />
                {draft.color && (
                  <Button variant="outline" size="sm" onClick={() => patch({ color: undefined })}>
                    {t('map.useFactionColor')}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="layer-icon">{t('map.icon')}</Label>
              <Input
                id="layer-icon"
                value={draft.icon ?? ''}
                onChange={(e) => patch({ icon: e.target.value })}
                placeholder="💰"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('map.visibility')}</Label>
            <SearchableSelect
              options={rankOptions}
              value={draft.minRankLevel == null ? '' : String(draft.minRankLevel)}
              onValueChange={(v: string) => patch({ minRankLevel: v === '' ? null : Number(v) })}
            />
            <p className="text-micro text-zinc-500">{t('map.visibilityHint')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button disabled={!draft.name.trim() || saving} onClick={() => onSave(draft)}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shown when nothing has been picked, and the value the picker starts on. */
const DEFAULT_MARKER_COLOR = '#6366f1';

/**
 * A small fixed palette, because picking a colour from a full wheel produces
 * maps where every marker is a slightly different mud. These are spaced far
 * enough apart to stay distinguishable at a glance on a dark map, and the
 * native picker is still there for anybody who wants an exact shade.
 */
const MARKER_SWATCHES = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#e5e7eb', // near-white, for anything that must not read as a category
] as const;

function toInput(marker: MapMarker): MapMarkerInput {
  return {
    kind: marker.kind,
    name: marker.name,
    description: marker.description ?? '',
    category: marker.category ?? '',
    color: marker.color ?? undefined,
    icon: marker.icon ?? '',
    points: marker.points,
    layerId: marker.layerId,
  };
}

/**
 * Paste what the game printed.
 *
 * The reason this beats a screenshot in Discord: a player runs `/coords`,
 * copies the line, and the pin lands exactly where they stood — including the
 * floor, which clicking a flat map can never express.
 */
function PasteCoordinates({ onPlace }: { onPlace: (point: GamePoint) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const parsed = parseGamePoint(text);

  return (
    <div className="space-y-1 rounded-md border border-[var(--line-2)] bg-[var(--fill-2)] p-2">
      <Label htmlFor="paste-coords" className="text-micro text-zinc-400">
        {t('map.pasteLabel')}
      </Label>
      <div className="flex gap-2">
        <Input
          id="paste-coords"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="-1037.2, -2737.5, 20.1"
          className="font-mono text-xs"
        />
        <Button
          size="sm"
          disabled={!parsed}
          onClick={() => { if (parsed) { onPlace(parsed); setText(''); } }}
        >
          {t('map.place')}
        </Button>
      </div>
    </div>
  );
}

/** Name it, describe it, and decide who may see it. */
function MarkerEditor({
  value, isEdit, layers, saving, onCancel, onSave,
}: {
  value: MapMarkerInput;
  isEdit: boolean;
  layers: MapLayer[];
  saving: boolean;
  onCancel: () => void;
  onSave: (input: MapMarkerInput) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<MapMarkerInput>(value);
  const patch = (next: Partial<MapMarkerInput>) => setDraft((d) => ({ ...d, ...next }));

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('map.editMarker') : t('map.newMarker')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="marker-name">{t('map.name')}</Label>
            <Input
              id="marker-name"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('map.namePlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="marker-description">{t('map.description')}</Label>
            <Textarea
              id="marker-description"
              rows={2}
              value={draft.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="marker-color">{t('map.color')}</Label>
            <div className="flex items-center gap-2">
              <input
                id="marker-color"
                type="color"
                value={draft.color ?? DEFAULT_MARKER_COLOR}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-9 w-14 cursor-pointer rounded border border-[var(--line-2)] bg-transparent"
              />
              <Input
                value={draft.color ?? ''}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  patch({ color: v === '' ? undefined : v });
                }}
                placeholder={DEFAULT_MARKER_COLOR}
                className="w-32 font-mono text-xs"
                maxLength={7}
              />
              {draft.color && (
                <Button variant="outline" size="sm" onClick={() => patch({ color: undefined })}>
                  {t('map.useFactionColor')}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {MARKER_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={swatch}
                  onClick={() => patch({ color: swatch })}
                  style={{ background: swatch }}
                  className={cn(
                    'h-6 w-6 rounded-md border transition-transform',
                    draft.color?.toLowerCase() === swatch
                      ? 'border-white scale-110'
                      : 'border-black/40 hover:scale-105',
                  )}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="marker-category">{t('map.category')}</Label>
              <Input
                id="marker-category"
                value={draft.category ?? ''}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder={t('map.categoryPlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="marker-icon">{t('map.icon')}</Label>
              <Input
                id="marker-icon"
                value={draft.icon ?? ''}
                onChange={(e) => patch({ icon: e.target.value })}
                placeholder="📦"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t('map.layer')}</Label>
            <SearchableSelect
              options={layers.map((layer) => ({
                value: layer.id,
                label: layer.icon ? `${layer.icon} ${layer.name}` : layer.name,
                hint: layer.minRankLevel != null ? t('map.restricted') : undefined,
              }))}
              value={draft.layerId}
              onValueChange={(v: string) => patch({ layerId: v })}
            />
            <p className="text-micro text-zinc-500">{t('map.layerHint')}</p>
          </div>

          <p className="text-micro text-zinc-500">
            {t('map.coordCount', { count: draft.points.length })} ·{' '}
            <span className="font-mono">{draft.points[0] ? formatGamePoint(draft.points[0]) : ''}</span>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button disabled={!draft.name.trim() || saving} onClick={() => onSave(draft)}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
