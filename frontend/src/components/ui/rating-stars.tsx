'use client';

import { Star } from 'lucide-react';

/**
 * Five stars, clicked to set and clicked again to clear.
 *
 * Clearing matters more than it sounds: rating somebody is optional, and a
 * control you cannot take back turns a misclick into a permanent two out of
 * five on a record other people read.
 *
 * Without `onChange` it is a read-only display.
 */
export function RatingStars({
  value,
  onChange,
  label,
  size = 'sm',
}: {
  value: number | null;
  onChange?: (value: number | null) => void;
  label: string;
  size?: 'sm' | 'xs';
}) {
  const icon = size === 'xs' ? 'h-3 w-3' : 'h-4 w-4';
  if (!onChange) {
    return (
      <span className="flex items-center gap-0.5" role="img" aria-label={`${label}: ${value ?? 0}/5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star key={star} className={`${icon} ${value !== null && star <= value ? 'fill-amber-400 text-amber-400' : 'text-zinc-700'}`} />
        ))}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(value === star ? null : star)}
          aria-label={`${label}: ${star}`}
          aria-pressed={value !== null && star <= value}
          className="p-0.5 text-zinc-600 transition-colors hover:text-amber-300"
        >
          <Star className={`${icon} ${value !== null && star <= value ? 'fill-amber-400 text-amber-400' : ''}`} />
        </button>
      ))}
    </div>
  );
}
