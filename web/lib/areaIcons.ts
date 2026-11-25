/**
 * The glyph an Area of the business is drawn with (2026-11-25: Discover's Area cards carry one). The package that names
 * an Area picks it beside its name (`packs/<pack>/areas.yaml`), and the Area's owners may choose another on its page;
 * an Area with neither — a model's suggestion, Everything else, one named before icons — is drawn with the default,
 * never a blank. Drawn in the platform's one-colour tile (`ui/icon-square.tsx`): a hue would be decoration.
 */
import { ICON_NAMES, type IconName } from "@/components/ui/icon";

/** What an Area's owners choose from — the glyphs the packages draw their Areas with, and a few general ones. */
export const AREA_ICONS: IconName[] = [
  "cart", "cash", "spend", "pricetag", "discount", "returns", "card", "invoice", "recurring",
  "truck", "box", "route", "ontime", "store", "plane", "factory", "quality", "tool",
  "megaphone", "funnel", "target", "users", "contacts", "consent", "mood", "support", "event",
  "gauge", "activity", "chart", "layers",
];

/** Drawn when an Area names no glyph, or one the app does not draw. */
export const DEFAULT_AREA_ICON: IconName = "layers";

const DRAWN = new Set<string>(ICON_NAMES);

/** The glyph to draw for an Area's `icon`. */
export function areaIcon(icon?: string | null): IconName {
  return icon && DRAWN.has(icon) ? (icon as IconName) : DEFAULT_AREA_ICON;
}
