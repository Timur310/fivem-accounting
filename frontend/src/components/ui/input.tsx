import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "placeholder:text-zinc-600 selection:bg-[var(--brand-color,#6366f1)]/30 selection:text-foreground border-white/[0.08] flex h-9 w-full min-w-0 rounded-md border bg-white/[0.03] px-3 py-1 text-sm shadow-none transition-[color,border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[var(--brand-color,#6366f1)]/40 focus-visible:ring-[var(--brand-color,#6366f1)]/20 focus-visible:ring-[2px]",
        "aria-invalid:border-red-500/40 aria-invalid:ring-red-500/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
