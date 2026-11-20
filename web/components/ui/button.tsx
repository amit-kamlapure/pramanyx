import type * as React from "react"
import { Button as ThemesButton, IconButton as ThemesIconButton } from "@radix-ui/themes"

import { IconsBeside } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

/**
 * The one button system, on Radix Themes (ROADMAP §6 item 44).
 *
 * The call sites keep the names they have always used; each maps to a Themes variant and colour,
 * so the Theme's accent, grey, radius and scaling move every button at once.
 *
 *   default      solid, accent        the one Primary per view
 *   secondary    soft, grey, stronger  a filled secondary, and the pressed or chosen state beside soft ones: the same
 *                                     fill a step stronger (`.aug-btn-on`), no edge (2026-11-20)
 *   soft         soft, grey           a quiet secondary: a faint fill and no outline — still a button at rest (the user,
 *                                     2026-11-20: "Surfaces define structure. Spacing defines groups. Typography defines
 *                                     hierarchy. Borders are the exception.")
 *   outline      soft, grey           (and `minimal` and `ghost`, older names for the same look) — an outline until
 *                                     2026-11-20, the soft fill since, platform-wide
 *   destructive  soft, red
 *   link         ghost, accent        the "show source" affordance
 *   plain        ghost, grey          no chrome: a whole row, a bare icon, a name that opens what it names,
 *                                     or a button drawing its own edge. Never an action. Counted by lint:elements.
 *
 * An action looks like a button before the pointer reaches it (the user, 2026-11-03: "only when a user hovers do they
 * realise it's something clickable"). So `ghost`, which drew nothing until hover on 1,012 call sites, drew an edge — and
 * since 2026-11-20 a soft fill instead, the user's choice over an outline when borders became the exception. An icon
 * alone keeps none: a glyph already reads as a control.
 *
 * Themes has three heights (24, 32, 40). Ours were 26 and 22; both become 24 — its size 1
 * (the user chose Radix's own density, 2026-10-06).
 *
 * One thing is ours still: the one Primary per view scales to 0.96 while pressed (.aug-press;
 * decided 2026-09-14 — a single main action is worth feeling). `static` opts a Primary out.
 */
type Variant = "default" | "secondary" | "soft" | "outline" | "minimal" | "ghost" | "destructive" | "link" | "plain"
type Size = "default" | "lg" | "sm" | "xs" | "icon" | "icon-lg" | "icon-sm" | "icon-xs"

const LOOK: Record<Variant, { variant: "solid" | "surface" | "soft" | "outline" | "ghost"; color?: "gray" | "red"; highContrast?: boolean }> = {
  default: { variant: "solid" },
  secondary: { variant: "soft", color: "gray", highContrast: true },
  soft: { variant: "soft", color: "gray", highContrast: true },
  outline: { variant: "soft", color: "gray", highContrast: true },
  minimal: { variant: "soft", color: "gray", highContrast: true },
  ghost: { variant: "soft", color: "gray", highContrast: true },
  destructive: { variant: "soft", color: "red" },
  link: { variant: "ghost" },
  plain: { variant: "ghost", color: "gray" },
}

function Button({
  variant = "default",
  size = "default",
  static: isStatic = false,
  color: _color,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "color"> & {
  variant?: Variant | null
  size?: Size | null
  /** A Primary that should not scale on press. */
  static?: boolean
  color?: string
}) {
  const look = LOOK[variant ?? "default"]
  const cls = cn((variant ?? "default") === "default" && !isStatic && "aug-press", variant === "secondary" && "aug-btn-on", className)
  if (String(size).startsWith("icon")) {
    const iconLook = variant === "ghost" ? LOOK.plain : look
    return <ThemesIconButton data-slot="button" size="1" {...iconLook} className={cls} {...props}>{children}</ThemesIconButton>
  }
  return (
    <ThemesButton data-slot="button" size="1" {...look} className={cls} {...props}>
      <IconsBeside weight="semibold">{children}</IconsBeside>
    </ThemesButton>
  )
}

export { Button }
