/**
 * Which shapes a column of places fills, and which of its values matched none (the maps step, 2026-11-17).
 *
 * The install ships two sets of shapes in `web/public/geo/`:
 *   - the world's countries (`world.json`), the set the app's choropleth has always drawn;
 *   - the US states (`us-states.json`): the US Census Bureau's cartographic boundary files, 2017, as redistributed
 *     by us-atlas 3.0.1 (ISC).
 * A column is matched against both, by name, by a common or native spelling ("Brasil", "España", "Deutschland") or
 * by code (ISO 3166 alpha-2 and alpha-3 for countries, the postal code for states), and is filled from the set more
 * of its values match. What matched neither is returned, so the map can say it: a place with no shape is not a
 * place with no value. Matching is the same in the app, the coworker and an export, because they all call this.
 *
 * Regions, districts and cities have no shapes yet; a column of them matches nothing here, and no map is offered.
 */

export type ShapeSet = "countries" | "us_states";

export const SHAPES: Record<ShapeSet, { url: string; label: string; credit: string }> = {
  countries: { url: "/geo/world.json", label: "countries", credit: "Country shapes: Natural Earth" },
  us_states: {
    url: "/geo/us-states.json", label: "US states",
    credit: "State shapes: US Census Bureau (2017), via us-atlas",
  },
};

/** The key a shape is matched by: its name with accents, case, dots, apostrophes and spacing taken out. */
export function placeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/**
 * Each country shape by the name `world.json` gives it, then the other ways a table writes it. Codes are ISO 3166-1
 * alpha-2 and alpha-3; the native spellings are the ones warehouses are seen to carry. A code a US state shares
 * ("IN", "CA") is in both tables: a column is read against each and filled from the set more of it matches. Namibia's
 * "NA" is left out on purpose — in a table it is far more often "not available" than a country.
 */
const COUNTRIES: Record<string, string[]> = {
  "Afghanistan": ["AF", "AFG"], "Aland": ["AX", "ALA", "Åland", "Aland Islands"], "Albania": ["AL", "ALB"],
  "Algeria": ["DZ", "DZA"], "American Samoa": ["AS", "ASM"], "Andorra": ["AD", "AND"], "Angola": ["AO", "AGO"],
  "Antigua and Barb.": ["AG", "ATG", "Antigua and Barbuda"], "Argentina": ["AR", "ARG"], "Armenia": ["AM", "ARM"],
  "Australia": ["AU", "AUS"], "Austria": ["AT", "AUT", "Österreich"], "Azerbaijan": ["AZ", "AZE"],
  "Bahamas": ["BS", "BHS"], "Bahrain": ["BH", "BHR"], "Bangladesh": ["BD", "BGD"], "Barbados": ["BB", "BRB"],
  "Belarus": ["BY", "BLR"], "Belgium": ["BE", "BEL", "Belgique", "België"], "Belize": ["BZ", "BLZ"],
  "Benin": ["BJ", "BEN"], "Bermuda": ["BM", "BMU"], "Bhutan": ["BT", "BTN"], "Bolivia": ["BO", "BOL"],
  "Bosnia and Herz.": ["BA", "BIH", "Bosnia and Herzegovina"], "Botswana": ["BW", "BWA"],
  "Br. Indian Ocean Ter.": ["IO", "IOT", "British Indian Ocean Territory"], "Brazil": ["BR", "BRA", "Brasil"],
  "Brunei": ["BN", "BRN", "Brunei Darussalam"], "Bulgaria": ["BG", "BGR"], "Burkina Faso": ["BF", "BFA"],
  "Burundi": ["BI", "BDI"], "Cambodia": ["KH", "KHM"], "Cameroon": ["CM", "CMR"], "Canada": ["CA", "CAN"],
  "Cape Verde": ["CV", "CPV", "Cabo Verde"], "Cayman Is.": ["KY", "CYM", "Cayman Islands"],
  "Central African Rep.": ["CF", "CAF", "Central African Republic"], "Chad": ["TD", "TCD"], "Chile": ["CL", "CHL"],
  "China": ["CN", "CHN", "People's Republic of China", "PRC"], "Colombia": ["CO", "COL"], "Comoros": ["KM", "COM"],
  "Congo": ["CG", "COG", "Republic of the Congo", "Congo-Brazzaville"], "Costa Rica": ["CR", "CRI"],
  "Croatia": ["HR", "HRV", "Hrvatska"], "Cuba": ["CU", "CUB"], "Curaçao": ["CW", "CUW"], "Cyprus": ["CY", "CYP"],
  "Czech Rep.": ["CZ", "CZE", "Czech Republic", "Czechia"], "Côte d'Ivoire": ["CI", "CIV", "Ivory Coast"],
  "Dem. Rep. Congo": ["CD", "COD", "Democratic Republic of the Congo", "DR Congo", "DRC", "Congo-Kinshasa"],
  "Dem. Rep. Korea": ["KP", "PRK", "North Korea", "Democratic People's Republic of Korea"],
  "Denmark": ["DK", "DNK", "Danmark"], "Djibouti": ["DJ", "DJI"], "Dominica": ["DM", "DMA"],
  "Dominican Rep.": ["DO", "DOM", "Dominican Republic"], "Ecuador": ["EC", "ECU"], "Egypt": ["EG", "EGY"],
  "El Salvador": ["SV", "SLV"], "Eq. Guinea": ["GQ", "GNQ", "Equatorial Guinea"], "Eritrea": ["ER", "ERI"],
  "Estonia": ["EE", "EST"], "Ethiopia": ["ET", "ETH"], "Faeroe Is.": ["FO", "FRO", "Faroe Islands", "Faeroe Islands"],
  "Falkland Is.": ["FK", "FLK", "Falkland Islands"], "Fiji": ["FJ", "FJI"], "Finland": ["FI", "FIN", "Suomi"],
  "Fr. Polynesia": ["PF", "PYF", "French Polynesia"],
  "Fr. S. Antarctic Lands": ["TF", "ATF", "French Southern and Antarctic Lands", "French Southern Territories"],
  "France": ["FR", "FRA"], "Gabon": ["GA", "GAB"], "Gambia": ["GM", "GMB"], "Georgia": ["GE", "GEO"],
  "Germany": ["DE", "DEU", "Deutschland"], "Ghana": ["GH", "GHA"], "Greece": ["GR", "GRC", "Hellas"],
  "Greenland": ["GL", "GRL"], "Grenada": ["GD", "GRD"], "Guam": ["GU", "GUM"], "Guatemala": ["GT", "GTM"],
  "Guinea": ["GN", "GIN"], "Guinea-Bissau": ["GW", "GNB"], "Guyana": ["GY", "GUY"], "Haiti": ["HT", "HTI"],
  "Heard I. and McDonald Is.": ["HM", "HMD", "Heard Island and McDonald Islands"], "Honduras": ["HN", "HND"],
  "Hungary": ["HU", "HUN"], "Iceland": ["IS", "ISL"], "India": ["IN", "IND", "Bharat"], "Indonesia": ["ID", "IDN"],
  "Iran": ["IR", "IRN", "Islamic Republic of Iran"], "Iraq": ["IQ", "IRQ"],
  "Ireland": ["IE", "IRL", "Republic of Ireland", "Éire"], "Isle of Man": ["IM", "IMN"], "Israel": ["IL", "ISR"],
  "Italy": ["IT", "ITA", "Italia"], "Jamaica": ["JM", "JAM"], "Japan": ["JP", "JPN", "Nippon"],
  "Jersey": ["JE", "JEY"], "Jordan": ["JO", "JOR"], "Kazakhstan": ["KZ", "KAZ"], "Kenya": ["KE", "KEN"],
  "Kiribati": ["KI", "KIR"], "Korea": ["KR", "KOR", "South Korea", "Republic of Korea", "Korea, Republic of"],
  "Kuwait": ["KW", "KWT"], "Kyrgyzstan": ["KG", "KGZ"], "Lao PDR": ["LA", "LAO", "Laos"], "Latvia": ["LV", "LVA"],
  "Lebanon": ["LB", "LBN"], "Lesotho": ["LS", "LSO"], "Liberia": ["LR", "LBR"], "Libya": ["LY", "LBY"],
  "Liechtenstein": ["LI", "LIE"], "Lithuania": ["LT", "LTU"], "Luxembourg": ["LU", "LUX"],
  "Macedonia": ["MK", "MKD", "North Macedonia"], "Madagascar": ["MG", "MDG"], "Malawi": ["MW", "MWI"],
  "Malaysia": ["MY", "MYS"], "Mali": ["ML", "MLI"], "Malta": ["MT", "MLT"], "Mauritania": ["MR", "MRT"],
  "Mauritius": ["MU", "MUS"], "Mexico": ["MX", "MEX", "México"], "Micronesia": ["FM", "FSM"], "Moldova": ["MD", "MDA"],
  "Mongolia": ["MN", "MNG"], "Montenegro": ["ME", "MNE"], "Montserrat": ["MS", "MSR"], "Morocco": ["MA", "MAR"],
  "Mozambique": ["MZ", "MOZ"], "Myanmar": ["MM", "MMR", "Burma"], "N. Cyprus": ["Northern Cyprus"],
  "N. Mariana Is.": ["MP", "MNP", "Northern Mariana Islands"], "Namibia": ["NAM"], "Nepal": ["NP", "NPL"],
  "Netherlands": ["NL", "NLD", "Holland", "Nederland"], "New Caledonia": ["NC", "NCL"], "New Zealand": ["NZ", "NZL"],
  "Nicaragua": ["NI", "NIC"], "Niger": ["NE", "NER"], "Nigeria": ["NG", "NGA"], "Niue": ["NU", "NIU"],
  "Norway": ["NO", "NOR", "Norge"], "Oman": ["OM", "OMN"], "Pakistan": ["PK", "PAK"], "Palau": ["PW", "PLW"],
  "Palestine": ["PS", "PSE"], "Panama": ["PA", "PAN"], "Papua New Guinea": ["PG", "PNG"], "Paraguay": ["PY", "PRY"],
  "Peru": ["PE", "PER"], "Philippines": ["PH", "PHL"], "Poland": ["PL", "POL", "Polska"],
  "Portugal": ["PT", "PRT"], "Puerto Rico": ["PR", "PRI"], "Qatar": ["QA", "QAT"], "Romania": ["RO", "ROU"],
  "Russia": ["RU", "RUS", "Russian Federation"], "Rwanda": ["RW", "RWA"],
  "S. Geo. and S. Sandw. Is.": ["GS", "SGS", "South Georgia and the South Sandwich Islands"],
  "S. Sudan": ["SS", "SSD", "South Sudan"], "Saint Helena": ["SH", "SHN"], "Saint Lucia": ["LC", "LCA"],
  "Samoa": ["WS", "WSM"], "Saudi Arabia": ["SA", "SAU"], "Senegal": ["SN", "SEN"], "Serbia": ["RS", "SRB"],
  "Seychelles": ["SC", "SYC"], "Siachen Glacier": [], "Sierra Leone": ["SL", "SLE"], "Singapore": ["SG", "SGP"],
  "Slovakia": ["SK", "SVK"], "Slovenia": ["SI", "SVN"], "Solomon Is.": ["SB", "SLB", "Solomon Islands"],
  "Somalia": ["SO", "SOM"], "South Africa": ["ZA", "ZAF"], "Spain": ["ES", "ESP", "España"],
  "Sri Lanka": ["LK", "LKA"], "St. Pierre and Miquelon": ["PM", "SPM", "Saint Pierre and Miquelon"],
  "St. Vin. and Gren.": ["VC", "VCT", "Saint Vincent and the Grenadines"], "Sudan": ["SD", "SDN"],
  "Suriname": ["SR", "SUR"], "Swaziland": ["SZ", "SWZ", "Eswatini"], "Sweden": ["SE", "SWE", "Sverige"],
  "Switzerland": ["CH", "CHE", "Schweiz", "Suisse"], "Syria": ["SY", "SYR"],
  "São Tomé and Principe": ["ST", "STP", "Sao Tome and Principe"], "Tajikistan": ["TJ", "TJK"],
  "Tanzania": ["TZ", "TZA"], "Thailand": ["TH", "THA"], "Timor-Leste": ["TL", "TLS", "East Timor"], "Togo": ["TG", "TGO"],
  "Tonga": ["TO", "TON"], "Trinidad and Tobago": ["TT", "TTO"], "Tunisia": ["TN", "TUN"],
  "Turkey": ["TR", "TUR", "Türkiye"], "Turkmenistan": ["TM", "TKM"], "Turks and Caicos Is.": ["TC", "TCA", "Turks and Caicos Islands"],
  "U.S. Virgin Is.": ["VI", "VIR", "US Virgin Islands", "United States Virgin Islands"], "Uganda": ["UG", "UGA"],
  "Ukraine": ["UA", "UKR"], "United Arab Emirates": ["AE", "ARE", "UAE"],
  "United Kingdom": ["GB", "GBR", "UK", "Great Britain", "Britain"],
  "United States": ["US", "USA", "United States of America", "U.S.A.", "America"], "Uruguay": ["UY", "URY"],
  "Uzbekistan": ["UZ", "UZB"], "Vanuatu": ["VU", "VUT"], "Venezuela": ["VE", "VEN"], "Vietnam": ["VN", "VNM", "Viet Nam"],
  "W. Sahara": ["EH", "ESH", "Western Sahara"], "Yemen": ["YE", "YEM"], "Zambia": ["ZM", "ZMB"],
  "Zimbabwe": ["ZW", "ZWE"],
};

/** Each state shape by its name in `us-states.json`, with its postal code and the other names it goes by. */
const US_STATES: Record<string, string[]> = {
  "Alabama": ["AL"], "Alaska": ["AK"], "Arizona": ["AZ"], "Arkansas": ["AR"], "California": ["CA"],
  "Colorado": ["CO"], "Connecticut": ["CT"], "Delaware": ["DE"],
  "District of Columbia": ["DC", "Washington DC", "Washington D.C."], "Florida": ["FL"], "Georgia": ["GA"],
  "Hawaii": ["HI"], "Idaho": ["ID"], "Illinois": ["IL"], "Indiana": ["IN"], "Iowa": ["IA"], "Kansas": ["KS"],
  "Kentucky": ["KY"], "Louisiana": ["LA"], "Maine": ["ME"], "Maryland": ["MD"], "Massachusetts": ["MA"],
  "Michigan": ["MI"], "Minnesota": ["MN"], "Mississippi": ["MS"], "Missouri": ["MO"], "Montana": ["MT"],
  "Nebraska": ["NE"], "Nevada": ["NV"], "New Hampshire": ["NH"], "New Jersey": ["NJ"], "New Mexico": ["NM"],
  "New York": ["NY"], "North Carolina": ["NC"], "North Dakota": ["ND"], "Ohio": ["OH"], "Oklahoma": ["OK"],
  "Oregon": ["OR"], "Pennsylvania": ["PA"], "Rhode Island": ["RI"], "South Carolina": ["SC"],
  "South Dakota": ["SD"], "Tennessee": ["TN"], "Texas": ["TX"], "Utah": ["UT"], "Vermont": ["VT"],
  "Virginia": ["VA"], "Washington": ["WA"], "West Virginia": ["WV"], "Wisconsin": ["WI"], "Wyoming": ["WY"],
  "American Samoa": ["AS"], "Guam": ["GU"], "Commonwealth of the Northern Mariana Islands": ["MP", "Northern Mariana Islands"],
  "Puerto Rico": ["PR"], "United States Virgin Islands": ["VI", "US Virgin Islands", "U.S. Virgin Islands"],
};

function index(table: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [shape, others] of Object.entries(table)) {
    for (const said of [shape, ...others]) {
      const k = placeKey(said);
      if (k && !out.has(k)) out.set(k, shape);
    }
  }
  return out;
}

const BY_SET: Record<ShapeSet, Map<string, string>> = { countries: index(COUNTRIES), us_states: index(US_STATES) };

/** The shape `value` names in `set`, or null. */
export function shapeOf(set: ShapeSet, value: unknown): string | null {
  return BY_SET[set].get(placeKey(value)) ?? null;
}

export interface PlaceMatch {
  set: ShapeSet;
  /** Each distinct value as the data gave it → the shape's name in `set`. */
  shapes: Map<string, string>;
  /** Distinct values that matched no shape in `set`, as the data gave them. */
  unmatched: string[];
  /** Distinct non-empty values read. */
  distinct: number;
}

/**
 * The set more of `values` match, and how each matched. Ties go to the countries. Null when no value matched either
 * set: there is then no map to draw from this column.
 */
export function matchPlaces(values: unknown[]): PlaceMatch | null {
  const distinct = [...new Set(values.map((v) => (v == null ? "" : String(v).trim())).filter(Boolean))];
  let best: PlaceMatch | null = null;
  for (const set of ["countries", "us_states"] as ShapeSet[]) {
    const shapes = new Map<string, string>();
    const unmatched: string[] = [];
    for (const v of distinct) {
      const s = shapeOf(set, v);
      if (s) shapes.set(v, s); else unmatched.push(v);
    }
    if (shapes.size && (!best || shapes.size > best.shapes.size)) best = { set, shapes, unmatched, distinct: distinct.length };
  }
  return best;
}

/**
 * The column of `columns` whose values most often name a shape, with how they matched — read among the columns a
 * chart treats as labels (`candidates`, indices). A column matches when at least half its distinct values do, so a
 * column of product names that happens to hold "Georgia" is not taken for a map. Null when none does.
 */
export function placeColumn(
  columns: string[], rows: unknown[][], candidates: number[],
): { index: number; column: string; match: PlaceMatch } | null {
  let best: { index: number; column: string; match: PlaceMatch } | null = null;
  for (const i of candidates) {
    const match = matchPlaces(rows.map((r) => r[i]));
    if (!match || match.shapes.size * 2 < match.distinct) continue;
    if (!best || match.shapes.size > best.match.shapes.size) best = { index: i, column: columns[i], match };
  }
  return best;
}
