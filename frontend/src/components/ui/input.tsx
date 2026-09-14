import * as React from "react"

import { cn } from "@/lib/utils"
import { controlClasses, type ControlSize } from "@/components/ui/control-size"

function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & { size?: ControlSize }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "placeholder:text-zinc-600 selection:bg-[var(--brand-color,#6366f1)]/30 selection:text-foreground border-[var(--line-2)] flex w-full min-w-0 rounded-md border bg-[var(--fill-2)] py-1 shadow-none transition-[color,border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[var(--brand-color,#6366f1)]/40 focus-visible:ring-[var(--brand-color,#6366f1)]/20 focus-visible:ring-[2px]",
        "aria-invalid:border-red-500/40 aria-invalid:ring-red-500/20",
        controlClasses(size),
        className
      )}
      {...props}
    />
  )
}

export { Input }
