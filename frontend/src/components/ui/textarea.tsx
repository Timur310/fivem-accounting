import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-zinc-600 border-white/[0.08] flex min-h-[60px] w-full rounded-md border bg-white/[0.03] px-3 py-2 text-sm shadow-none transition-[color,border-color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[var(--brand-color,#6366f1)]/40 focus-visible:ring-[var(--brand-color,#6366f1)]/20 focus-visible:ring-[2px]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
