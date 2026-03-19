/**
 * Kreo Skeleton - Placeholder de carga
 */
import * as React from "react"
import { cn } from "@/lib/utils"

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular" | "rounded"
  animation?: "wave" | "pulse" | "none"
}

const animationStyles = {
  wave: "animate-pulse bg-[var(--muted)]",
  pulse: "animate-pulse bg-[var(--muted)]",
  none: "bg-[var(--muted)]",
}

function Skeleton({
  variant = "text",
  animation = "pulse",
  className,
  style,
  ...props
}: SkeletonProps) {
  const variantStyles = {
    text: "rounded-[var(--radius-sm)]",
    circular: "rounded-full",
    rectangular: "",
    rounded: "rounded-[var(--radius)]",
  }
  return (
    <div
      data-slot="skeleton"
      className={cn(
        animationStyles[animation],
        variantStyles[variant],
        "transition-opacity",
        className
      )}
      style={style}
      {...props}
    />
  )
}

export { Skeleton }
