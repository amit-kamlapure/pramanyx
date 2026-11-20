import type * as React from "react"
import { TextField } from "@radix-ui/themes"

import { fieldClass, fieldStyle } from "@/components/ui/field"

/** A field, on Radix Themes: its size-2 text field — 32px, 14px text, the size of every form
 *  field (`ui/field.ts`). `className` and `style` land on the field's box and may place it, not
 *  size or paint it; `bespoke` is a field that draws itself (24px, everything as given). */
function Input({ className, style, size: _size, color: _color, bespoke, leading, trailing, defaultValue, value, variant, ...props }:
  Omit<React.ComponentProps<"input">, "size" | "color"> & {
    size?: number; color?: string; bespoke?: boolean; leading?: React.ReactNode;
    /** At the field's right end, inside it — a search's clear. */
    trailing?: React.ReactNode;
    /** "soft": a faint fill and no outline, for a field on a quiet surface (the SQL Editor's catalog search, 2026-11-20). */
    variant?: "surface" | "soft";
  }) {
  // Soft when asked, and by default for a field that is not a form's — a toolbar's search, a rename in place
  // (2026-11-20, borders are the exception); a form's field keeps its edge, where the eye looks for what to fill in.
  return (
    <TextField.Root data-slot="input" data-field={bespoke ? undefined : "form"} size={bespoke ? "1" : "2"}
      className={bespoke ? className : fieldClass(className)} style={bespoke ? style : fieldStyle(style)}
      {...(value !== undefined ? { value: value as string | number } : {})}
      {...(defaultValue !== undefined ? { defaultValue: defaultValue as string | number } : {})}
      {...(variant === "soft" || (bespoke && variant === undefined) ? { variant: "soft" as const, color: "gray" as const } : {})}
      {...(props as Record<string, unknown>)}>
      {leading != null && <TextField.Slot>{leading}</TextField.Slot>}
      {trailing != null && trailing !== false && <TextField.Slot side="right">{trailing}</TextField.Slot>}
    </TextField.Root>
  )
}

export { Input }
