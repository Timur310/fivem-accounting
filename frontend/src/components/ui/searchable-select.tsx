'use client';

import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { controlClasses, type ControlSize } from '@/components/ui/control-size';
import { useTranslation } from '@/providers/i18n-provider';

/**
 * A <Select> that can be typed into.
 *
 * Radix's Select only offers first-letter typeahead, which stops helping once a
 * list runs past a screenful — member and item-type lists both do. This keeps
 * the same value/onValueChange shape as the Radix trigger it replaces, so a
 * caller swaps one for the other without touching its state, and adds a filter
 * box over the options.
 *
 * Deliberately not portalled: the panel renders inside the trigger's own
 * wrapper, which keeps it inside a dialog's focus trap and lets it inherit
 * `--brand-color` from the surrounding tree.
 */
export interface SearchableSelectOption {
  value: string;
  /** Shown in the trigger and the list, and matched against the filter box. */
  label: string;
  /** Muted text after the label — a unit, a Discord name. Also matched. */
  hint?: string;
  /** Leading node: an item icon, an avatar, a colour swatch. */
  icon?: React.ReactNode;
  /** Trailing node for a styled tag the plain `hint` text cannot carry. */
  badge?: React.ReactNode;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  /**
   * Options needed before the filter box appears. A search field over three
   * statuses is noise, so short lists stay a plain dropdown while member and
   * item-type lists — the ones that outgrow a screen — get one.
   */
  searchThreshold?: number;
  /**
   * Height, shared with Button and Input so a row of mixed controls lines up.
   * See control-size.ts.
   */
  size?: ControlSize;
  /** Sizing for the wrapper — the trigger fills it. */
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  'aria-label'?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  searchThreshold = 8,
  size = 'default',
  className,
  triggerClassName,
  contentClassName,
  'aria-label': ariaLabel,
}: SearchableSelectProps) {
  // Generic fallbacks live here rather than in the prop defaults so they follow
  // the interface language; every call site that has something more specific to
  // say still passes its own text.
  const { t } = useTranslation();
  const placeholderText = placeholder ?? t('select.placeholder');
  const searchPlaceholderText = searchPlaceholder ?? t('select.search');
  const emptyMessageText = emptyMessage ?? t('select.noMatches');

  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // The panel can be wider and taller than the trigger it hangs off, so a
  // trigger near an edge would otherwise push the panel off-screen.
  const [flip, setFlip] = React.useState({ right: false, up: false });

  const selected = options.find((o) => o.value === value);
  const showSearch = options.length >= searchThreshold;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
    : options;

  const close = React.useCallback((focusTrigger = false) => {
    setOpen(false);
    setSearch('');
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openPanel = () => {
    setSearch('');
    const i = options.findIndex((o) => o.value === value);
    setHighlight(i >= 0 ? i : 0);
    setOpen(true);
  };

  // Close on a click anywhere outside. A full-screen overlay would sit under a
  // dialog's own content, leaving the panel open on clicks inside the dialog.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close]);

  // Keep the highlighted row visible while arrowing through a long list.
  React.useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  // Measure once the panel is up and flip it back over the trigger on
  // whichever axis has run out of room.
  React.useLayoutEffect(() => {
    if (!open) { setFlip({ right: false, up: false }); return; }
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const rect = panel.getBoundingClientRect();
    setFlip({
      right: rect.right > window.innerWidth - 8 && trigger.getBoundingClientRect().right - rect.width > 8,
      up: rect.bottom > window.innerHeight - 8 && trigger.getBoundingClientRect().top - rect.height > 8,
    });
  }, [open]);

  // Without a filter box there is nothing to autofocus, so the list itself
  // takes focus and keeps arrow keys working.
  React.useEffect(() => {
    if (open && !showSearch) listRef.current?.focus();
  }, [open, showSearch]);

  // Escape has to dismiss the panel without dismissing whatever it opened
  // inside. Radix's dialog listens for it on `document` in the capture phase,
  // where a React handler cannot stop it — so this claims the key one step
  // earlier, on the window, and only while the panel is open.
  React.useEffect(() => {
    if (!open) return;
    const onEscapeCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close(true);
    };
    window.addEventListener('keydown', onEscapeCapture, true);
    return () => window.removeEventListener('keydown', onEscapeCapture, true);
  }, [open, close]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[highlight];
      if (option) {
        onValueChange(option.value);
        close(true);
      }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        className={cn(
          'border-white/[0.08] focus-visible:border-[var(--brand-color,#6366f1)]/40 focus-visible:ring-[var(--brand-color,#6366f1)]/20',
          'flex w-full items-center justify-between gap-2 rounded-md border bg-white/[0.03] py-2',
          controlClasses(size),
          'whitespace-nowrap shadow-none outline-none transition-[color,border-color] focus-visible:ring-[2px]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.icon}
          {selected ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{selected.label}</span>
              {selected.hint && <span className="shrink-0 text-zinc-500">{selected.hint}</span>}
              {selected.badge}
            </span>
          ) : (
            <span className="truncate text-zinc-600">{placeholderText}</span>
          )}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-40" />
      </button>

      {open && (
        <div
          ref={panelRef}
          className={cn(
            'absolute z-50 w-full rounded-md border border-white/[0.08]',
            flip.right ? 'right-0' : 'left-0',
            flip.up ? 'bottom-full mb-1' : 'top-full mt-1',
            'bg-[#101114] p-1 shadow-2xl shadow-black/40',
            // Only the filter box needs more room than the trigger has.
            showSearch && 'min-w-[13rem]',
            contentClassName,
          )}
        >
          {showSearch && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                autoFocus
                value={search}
                placeholder={searchPlaceholderText}
                onChange={(e) => { setSearch(e.target.value); setHighlight(0); }}
                onKeyDown={handleKeyDown}
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}
          <div
            ref={listRef}
            role="listbox"
            tabIndex={showSearch ? undefined : -1}
            onKeyDown={showSearch ? undefined : handleKeyDown}
            className={cn('max-h-56 overflow-y-auto outline-none', showSearch && 'mt-1')}
          >
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-zinc-500">{emptyMessageText}</p>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.value || `__${o.label}`}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => { onValueChange(o.value); close(true); }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-300',
                    i === highlight && 'bg-white/[0.06] text-zinc-100',
                  )}
                >
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="truncate text-xs text-zinc-500">{o.hint}</span>}
                  {o.badge}
                  {o.value === value && (
                    <Check className="ml-auto size-4 shrink-0 text-[var(--brand-color,#6366f1)]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
