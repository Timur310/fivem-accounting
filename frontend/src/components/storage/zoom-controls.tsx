'use client';

import { Maximize2, Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/providers/i18n-provider';

/** The cell size the zoom buttons treat as 100%. */
export const BASE_CELL = 36;
export const MIN_CELL = 16;
export const MAX_CELL = 64;

/**
 * The biggest cell size that shows the whole room in this element, within
 * the zoom range — so a big depot opens zoomed out and a cupboard does not
 * open as a postage stamp.
 */
export function fitCell(el: HTMLElement, width: number, height: number): number {
  const availableW = el.clientWidth - 80;
  const availableH = Math.max(320, window.innerHeight * 0.62);
  const best = Math.floor(Math.min(availableW / width, availableH / height));
  return Math.min(MAX_CELL, Math.max(MIN_CELL, best));
}

/** Zoom out, the current zoom (click to fit), zoom in — floating over a canvas. */
export function ZoomControls({ cell, onZoom, onFit }: { cell: number; onZoom: (d: 1 | -1) => void; onFit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-full border border-zinc-700/70 bg-zinc-900/90 p-1 shadow-xl backdrop-blur">
      <button type="button" onClick={() => onZoom(-1)} disabled={cell <= MIN_CELL} aria-label={t('storage.zoomOut')} title={`${t('storage.zoomOut')} (−)`} className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40 pointer-coarse:size-9">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onFit} title={`${t('storage.editor.fit')} (0)`} className="min-w-[3.25rem] rounded-full px-1.5 text-center text-[11px] tabular-nums text-zinc-300 hover:bg-zinc-800">
        {Math.round((cell / BASE_CELL) * 100)}%
      </button>
      <button type="button" onClick={() => onZoom(1)} disabled={cell >= MAX_CELL} aria-label={t('storage.zoomIn')} title={`${t('storage.zoomIn')} (+)`} className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40 pointer-coarse:size-9">
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onFit} aria-label={t('storage.editor.fit')} title={`${t('storage.editor.fit')} (0)`} className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 pointer-coarse:size-9">
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
