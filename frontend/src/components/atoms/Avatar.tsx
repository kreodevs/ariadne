/**
 * Kreo Avatar - Avatar con iniciales o imagen
 */
import { forwardRef, useState } from "react"
import { User } from "lucide-react"
import { cn } from "@/lib/utils"

const sizeConfig = {
  xs: { container: "w-6 h-6", text: "text-[10px]", icon: "w-3 h-3" },
  sm: { container: "w-8 h-8", text: "text-xs", icon: "w-4 h-4" },
  md: { container: "w-10 h-10", text: "text-sm", icon: "w-5 h-5" },
  lg: { container: "w-12 h-12", text: "text-base", icon: "w-6 h-6" },
}

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

export interface AvatarProps {
  src?: string
  alt?: string
  name?: string
  size?: keyof typeof sizeConfig
  className?: string
}

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ src, alt = "Avatar", name, size = "md", className = "" }, ref) => {
    const [imageError, setImageError] = useState(false)
    const config = sizeConfig[size]

    const content = () => {
      if (src && !imageError) {
        return (
          <img
            src={src}
            alt={alt}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover rounded-full"
          />
        )
      }
      if (name) {
        return (
          <span
            className={cn(
              "font-medium text-[var(--accent-foreground)]",
              config.text
            )}
          >
            {getInitials(name)}
          </span>
        )
      }
      return (
        <User
          className={cn("text-[var(--foreground-muted)]", config.icon)}
        />
      )
    }

    return (
      <div
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0",
          config.container,
          !src || imageError ? "bg-[var(--secondary)]" : "",
          name && (!src || imageError) ? "bg-[var(--accent)]" : "",
          className
        )}
        style={
          name && (!src || imageError)
            ? { backgroundColor: "var(--accent)" }
            : undefined
        }
      >
        {content()}
      </div>
    )
  }
)
Avatar.displayName = "Avatar"
