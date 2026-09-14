import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[2px] active:scale-[0.97]",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--brand-color,#6366f1)] text-white shadow-none hover:brightness-110",
        destructive:
          "bg-destructive text-white shadow-none hover:brightness-110",
        outline:
          "border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.12]",
        secondary:
          "bg-white/[0.06] text-foreground hover:bg-white/[0.09]",
        ghost:
          "hover:bg-white/[0.06] hover:text-foreground",
        link: "text-[var(--brand-color,#6366f1)] underline-offset-4 hover:underline",
      },
      // Shares its names and heights with Input and SearchableSelect — see
      // control-size.ts. A row picks one size and every control on it agrees,
      // instead of each call site patching a height by hand.
      size: {
        // 28px. Inline actions inside a row that is already dense: pagination
        // arrows, the resolve/decline pair on a support ticket. It existed as
        // `size="sm" className="h-7"` in a dozen places before it had a name.
        xs: "h-7 rounded-md gap-1 px-2 text-xs has-[>svg]:px-1.5",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        lg: "h-10 rounded-md px-5 has-[>svg]:px-4",
        touch: "h-11 rounded-md px-6 has-[>svg]:px-5",
        // Square, and matched to the heights above so an icon button never
        // disagrees with the field it sits next to.
        // 28px, for the edit/delete affordances inside dense table rows.
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        icon: "size-9",
        "icon-lg": "size-10",
        "icon-touch": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      // A bare <button> inside a <form> defaults to type="submit", which makes
      // every Cancel and every stepper submit the form the moment dialogs are
      // wrapped in one. Defaulting to "button" inverts that: submitting is
      // opt-in via type="submit" on the one button that means it. `asChild`
      // renders a Slot, which passes the attribute down to whatever it wraps
      // and is harmless on a non-button element.
      type={asChild ? undefined : "button"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
