import type * as React from "react"
import { Badge as ThemesBadge } from "@radix-ui/themes"

/** A badge, on Radix Themes: tint and text of one hue — its `soft` look since 2026-11-20, when borders became the
 *  exception (the `surface` look before added a border of the same hue). A hue appears only when a reader can name the
 *  state it means (INSTRUMENT.md §2). */
type Variant = "default" | "secondary" | "destructive" | "green" | "amber" | "violet" | "cyan" | "outline" | "ghost" | "link"

const LOOK: Record<Variant, { variant: "surface" | "outline" | "soft"; color?: "gray" | "red" | "green" | "amber" | "violet" | "cyan" }> = {
  default: { variant: "soft" },
  secondary: { variant: "soft", color: "gray" },
  destructive: { variant: "soft", color: "red" },
  green: { variant: "soft", color: "green" },
  amber: { variant: "soft", color: "amber" },
  violet: { variant: "soft", color: "violet" },
  cyan: { variant: "soft", color: "cyan" },
  outline: { variant: "soft", color: "gray" },
  ghost: { variant: "soft", color: "gray" },
  link: { variant: "soft" },
}

function Badge({ variant = "default", color: _color, ...props }: Omit<React.ComponentProps<"span">, "color"> & {
  variant?: Variant | null
  color?: string
}) {
  return <ThemesBadge data-slot="badge" size="1" {...LOOK[variant ?? "default"]} {...props} />
}

export { Badge }
