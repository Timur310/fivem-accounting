'use client';

import { useId } from 'react';
import * as m from 'motion/react-m';
import { glide } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

/**
 * A row of mutually exclusive choices, with a pill that slides to the one
 * picked.
 *
 * Seven screens had hand-written copies of this — the same border, the same
 * fill, slightly different heights — and each one jumped its highlight from
 * one button to the next. The pill is a single element shared by layout, so
 * it travels there instead, the same way the sidebar's highlight does.
 *
 * The layout id is per instance. Two of these on one screen (the crew board
 * has a sort and a period side by side) must not trade pills with each other.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'sm',
  fill = false,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** What the group chooses, for screen readers. */
  label: string;
  /** `sm` for filters in a toolbar, `md` for a choice inside a form. */
  size?: 'sm' | 'md';
  /** Stretch the buttons to share the full width. */
  fill?: boolean;
  className?: string;
}) {
  const id = useId();

  return (
    <div
      role="tablist"
      aria-label={label}
      // Scrolls sideways rather than overflowing when there are more choices
      // than a phone is wide — the complaint filter has five.
      className={cn('flex max-w-full overflow-x-auto rounded-lg border border-[var(--line-2)] p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || '__all'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium transition-colors',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-xs',
              fill && 'flex-1',
              active ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {active && (
              <m.span
                layoutId={`segmented-${id}`}
                aria-hidden
                className="absolute inset-0 rounded-md bg-[var(--fill-4)]"
                transition={glide}
              />
            )}
            {option.icon && <span className="relative">{option.icon}</span>}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
