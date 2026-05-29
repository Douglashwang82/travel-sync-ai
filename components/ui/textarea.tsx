import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3.5 py-2 text-base transition-[border-color,box-shadow] duration-200 ring-offset-background placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:border-[var(--accent-line)] focus-visible:shadow-[var(--accent-line-glow)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-none",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
