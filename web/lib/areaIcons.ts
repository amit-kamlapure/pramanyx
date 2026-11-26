/**
 * The glyph an Area of the business is drawn with (2026-11-25: Discover's Area cards carry one). The package that names
 * an Area picks it beside its name (`packs/<pack>/areas.yaml`), and the Area's owners may choose another on its page;
 * an Area with neither — a model's suggestion, Everything else, one named before icons — is drawn with the default,
 * never a blank. Drawn in the platform's one-colour tile (`ui/icon-square.tsx`): a hue would be decoration (the user,
 * 2026-11-25: the picker without a colour row).
 *
 * What an Area's curators choose from is a searchable dropdown (`ui/icon-picker.tsx`, the user 2026-11-25: "such way of
 * choosing the icons (dropdown basically).. add the ones which are missing"): the glyphs below, grouped as a business
 * is read, each found by its name or the words beside it.
 */
import { ICON_NAMES, type IconName } from "@/components/ui/icon";

/** The glyphs an Area may be drawn with, in groups, each with the words a curator may search it by. */
export const AREA_ICON_GROUPS: { group: string; icons: [IconName, string][] }[] = [
  { group: "Sales and retail", icons: [
    ["cart", "orders sales shopping checkout"], ["bag", "shopping purchases retail"], ["basket", "grocery basket items"],
    ["store", "store shop branch retail"], ["pricetag", "price pricing margin tag"], ["discount", "promotions discount coupon markdown"],
    ["barcode", "products sku catalogue"], ["apparel", "fashion clothing apparel"], ["luxury", "luxury premium jewellery"],
    ["gift", "gifts rewards"], ["loyalty", "loyalty vip members"], ["returns", "returns refunds exchanges"],
  ] },
  { group: "Money", icons: [
    ["cash", "revenue cash money income"], ["spend", "cost spend profitability coins"], ["wallet", "wallet payments balance"],
    ["card", "payments card transactions"], ["bank", "bank treasury finance"], ["savings", "savings deposits"],
    ["receipt", "receipts orders billing"], ["invoice", "invoices receivables billing"], ["budget", "budget plan forecast"],
    ["tax", "tax accounting reports"], ["pie", "share mix allocation"], ["recurring", "subscriptions recurring revenue"],
  ] },
  { group: "Customers and marketing", icons: [
    ["users", "customers people users"], ["team", "segments groups teams"], ["contacts", "crm contacts accounts"],
    ["consent", "consent privacy opt-in"], ["mood", "experience satisfaction nps"], ["heart", "loyalty love retention"],
    ["support", "service support helpdesk"], ["phone", "calls contact centre"], ["mail", "email newsletters"],
    ["megaphone", "marketing campaigns"], ["ad", "advertising ads media"], ["share", "social sharing referrals"],
    ["partners", "partners affiliates network"], ["funnel", "conversion funnel traffic"], ["target", "acquisition goals targets"],
    ["event", "events clienteling calendar"],
  ] },
  { group: "People and organisation", icons: [
    ["badge", "employees staff identity"], ["recruiting", "recruiting headcount new joiners"], ["briefcase", "business work"],
    ["school", "training learning education"], ["org", "organisation structure hierarchy"], ["office", "offices buildings"],
    ["community", "community regions locations"], ["legal", "legal compliance contracts"], ["certificate", "certification quality standards"],
    ["flag", "goals milestones countries"],
  ] },
  { group: "Operations and logistics", icons: [
    ["truck", "delivery fulfilment shipping"], ["box", "inventory stock packages"], ["warehouse", "warehouse storage"],
    ["forklift", "logistics handling"], ["route", "transit routes network"], ["ship", "shipping freight ocean"],
    ["plane", "airline flights travel"], ["map", "maps territories"], ["world", "global international markets"],
    ["ontime", "service level on time"], ["hourglass", "lead time waiting"], ["checklist", "operations tasks process"],
    ["factory", "production manufacturing"], ["quality", "quality inspection"], ["tool", "maintenance repairs"],
    ["recycle", "sustainability recycling"],
  ] },
  { group: "Technology and data", icons: [
    ["db", "data warehouse database"], ["server", "infrastructure servers"], ["cloud", "cloud platform"],
    ["security", "security access risk"], ["devices", "devices apps digital"], ["api", "integrations api"],
  ] },
  { group: "Industries and places", icons: [
    ["hospital", "healthcare hospitals"], ["firstaid", "health care clinical"], ["pill", "pharmacy medicine"],
    ["energy", "energy utilities gas"], ["water", "water utilities"], ["leaf", "environment agriculture"],
    ["plant", "growth farming"], ["car", "automotive vehicles"], ["bus", "transport transit"],
    ["train", "rail transport"], ["bike", "mobility rentals"], ["hotel", "hospitality stays rooms"],
    ["food", "food delivery restaurants"], ["coffee", "cafes beverages"], ["pets", "pets animals"],
    ["property", "real estate property"],
  ] },
  { group: "Analysis and strategy", icons: [
    ["chart", "analysis reporting metrics"], ["activity", "engagement activity usage"], ["gauge", "operations performance kpi"],
    ["report", "reports analytics"], ["presentation", "board reviews"], ["trophy", "performance wins"],
    ["rocket", "launches growth"], ["puzzle", "strategy fit"], ["idea", "innovation ideas"],
    ["flask", "experiments testing"], ["layers", "general everything"],
  ] },
];

/** The groups as the picker shows them (`ui/icon-picker.tsx`): each group's glyphs, in order. */
export const AREA_ICON_PICKER: { group: string; icons: IconName[] }[] =
  AREA_ICON_GROUPS.map((g) => ({ group: g.group, icons: g.icons.map(([name]) => name) }));

/** What an Area's owners choose from — every glyph above, in order. */
export const AREA_ICONS: IconName[] = AREA_ICON_GROUPS.flatMap((g) => g.icons.map(([name]) => name));

/** The words each glyph is found by: its name and the words beside it. */
export const AREA_ICON_WORDS: Partial<Record<IconName, string>> = Object.fromEntries(
  AREA_ICON_GROUPS.flatMap((g) => g.icons.map(([name, words]) => [name, `${name} ${words}`]))) as Partial<Record<IconName, string>>;

/** Drawn when an Area names no glyph, or one the app does not draw. */
export const DEFAULT_AREA_ICON: IconName = "layers";

const DRAWN = new Set<string>(ICON_NAMES);

/** The glyph to draw for an Area's `icon`. */
export function areaIcon(icon?: string | null): IconName {
  return icon && DRAWN.has(icon) ? (icon as IconName) : DEFAULT_AREA_ICON;
}

/** The glyphs whose name or words hold every word typed, in their order — all of them for nothing typed. */
export function findAreaIcons(typed: string): IconName[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return AREA_ICONS;
  return AREA_ICONS.filter((name) => {
    const said = (AREA_ICON_WORDS[name] ?? name).toLowerCase();
    return words.every((w) => said.includes(w));
  });
}
