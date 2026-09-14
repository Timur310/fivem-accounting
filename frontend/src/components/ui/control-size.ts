/**
 * One height scale for every control that sits on a row with another control.
 *
 * Buttons, inputs and selects each had their own idea of "normal", so any row
 * mixing them was patched by hand at the call site — 123 hand-set heights
 * across the views, in six different values. The dashboard quick-log is the
 * clearest case: `h-11` steppers beside an `h-9` amount field, because there
 * was no size that meant "thumb target" and somebody reasonably invented one.
 *
 * Five steps, and the names say what they are for rather than how big they
 * are, so a row picks one size and every control on it agrees:
 *
 * - `xs`      inline actions inside an already-dense row
 * - `sm`      dense tables, inline filters, toolbar rows
 * - `default` ordinary forms
 * - `lg`      primary actions, and anything a phone user aims at
 * - `touch`   the one-thumb flows: quick log, approve, confirm
 *
 * Icon-only buttons keep their own square sizes, matched to the same heights
 * so an icon button never disagrees with the field beside it.
 */
export const CONTROL_HEIGHTS = {
  xs: 'h-7',
  sm: 'h-8',
  default: 'h-9',
  lg: 'h-10',
  touch: 'h-11',
} as const;

export type ControlSize = keyof typeof CONTROL_HEIGHTS;

/** Horizontal padding and text size that go with each height. */
export const CONTROL_PADDING: Record<ControlSize, string> = {
  xs: 'px-2 text-xs',
  sm: 'px-2.5 text-xs',
  default: 'px-3 text-sm',
  lg: 'px-3.5 text-sm',
  touch: 'px-4 text-sm',
};

/** The field classes for an input-like control at a given size. */
export function controlClasses(size: ControlSize = 'default'): string {
  return `${CONTROL_HEIGHTS[size]} ${CONTROL_PADDING[size]}`;
}
