/**
 * @fileoverview Placeholder de carga con animación pulse.
 */
import { cn } from "@/lib/utils"

/** Placeholder animado para contenido en carga. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
