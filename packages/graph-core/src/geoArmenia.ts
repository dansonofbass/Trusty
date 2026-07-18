/**
 * Geography scope — Trusty explores one country at a time; v1 is ARMENIA.
 *
 * Every location input in the app selects from this list (cities of Armenia,
 * or districts of Yerevan) instead of free text, so trust/recommendation geo
 * matching stays clean equality on canonical lowercase values. The top-of-app
 * selector picks the viewer's default scope; Yerevan is preselected.
 *
 * Also home to the recommendation CONTEXT taxonomy — the "for what situation"
 * picker (modal) used by the Recommend wizard. Pure data; no I/O.
 */

export const COUNTRY = "armenia";

/** Default scope — preselected everywhere. */
export const DEFAULT_GEO = "yerevan";

/** The 12 administrative districts of Yerevan (canonical lowercase values). */
export const YEREVAN_DISTRICTS: string[] = [
  "kentron",
  "arabkir",
  "ajapnyak",
  "avan",
  "davtashen",
  "erebuni",
  "kanaker-zeytun",
  "malatia-sebastia",
  "nor nork",
  "nork-marash",
  "nubarashen",
  "shengavit",
];

/** Main cities/towns of Armenia (canonical lowercase values). */
export const ARMENIA_CITIES: string[] = [
  "yerevan",
  "gyumri",
  "vanadzor",
  "vagharshapat",
  "hrazdan",
  "abovyan",
  "kapan",
  "armavir",
  "charentsavan",
  "ijevan",
  "goris",
  "dilijan",
  "sevan",
  "ashtarak",
  "artashat",
  "jermuk",
  "tsaghkadzor",
  "stepanavan",
  "sisian",
  "gavar",
  "yeghegnadzor",
  "meghri",
];

export interface GeoOptionGroup {
  label: string;
  options: string[];
}

/** Grouped options for location selects — Yerevan + its districts first. */
export const GEO_OPTIONS: GeoOptionGroup[] = [
  { label: "Yerevan", options: ["yerevan", ...YEREVAN_DISTRICTS] },
  { label: "Cities of Armenia", options: ARMENIA_CITIES.filter((c) => c !== "yerevan") },
];

/** Human label for a canonical geo value ("nor nork" → "Nor Nork"). */
export function geoLabel(value: string): string {
  return value
    .split(/[\s-]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(value.includes("-") ? "-" : " ");
}

/** True when the value is a known Armenian city or Yerevan district. */
export function isKnownGeo(value: string): boolean {
  const v = value.trim().toLowerCase();
  return ARMENIA_CITIES.includes(v) || YEREVAN_DISTRICTS.includes(v);
}

/* ------------------- recommendation context taxonomy ------------------- */

/** A context = the situation a recommendation is FOR ("for what?"). */
export interface ContextOption {
  value: string;
  label: string;
  /** Emoji glyph for the picker modal. */
  glyph: string;
}

const ctx = (value: string, glyph: string): ContextOption => ({
  value,
  label: value.replace(/_/g, " "),
  glyph,
});

/** Generic contexts that make sense for most topics. */
export const DEFAULT_CONTEXTS: ContextOption[] = [
  ctx("first_time", "🌱"),
  ctx("urgent", "⚡"),
  ctx("budget_friendly", "💸"),
  ctx("premium", "✨"),
  ctx("family_with_kids", "👨‍👩‍👧"),
  ctx("long_term", "📅"),
];

/** Topic-specific contexts, shown before the generic ones. */
export const CONTEXTS_BY_TOPIC: Record<string, ContextOption[]> = {
  restaurant: [
    ctx("date_night", "🕯️"),
    ctx("business_dinner", "💼"),
    ctx("family_with_kids", "👨‍👩‍👧"),
    ctx("quick_lunch", "🥪"),
    ctx("celebration", "🎉"),
    ctx("late_night", "🌙"),
  ],
  cafe: [
    ctx("remote_work", "💻"),
    ctx("first_date", "☕"),
    ctx("meetings", "🤝"),
    ctx("study", "📚"),
  ],
  food: [ctx("delivery", "🛵"), ctx("healthy", "🥗"), ctx("late_night", "🌙")],
  lawyer: [
    ctx("family_visa_case", "🛂"),
    ctx("immigration", "🌍"),
    ctx("business_registration", "🏢"),
    ctx("property_purchase", "🏠"),
    ctx("family_law", "👪"),
  ],
  immigration: [
    ctx("family_visa_case", "🛂"),
    ctx("work_permit", "🪪"),
    ctx("citizenship", "🏛️"),
    ctx("student_visa", "🎓"),
  ],
  doctor: [ctx("emergency", "🚑"), ctx("checkup", "🩺"), ctx("pediatric", "🧸"), ctx("chronic_care", "📅")],
  dentist: [ctx("emergency", "🚑"), ctx("orthodontics", "😁"), ctx("kids", "🧸"), ctx("implants", "🦷")],
  broker: [ctx("first_home", "🔑"), ctx("investment", "📈"), ctx("commercial", "🏢")],
  real_estate: [
    ctx("renting", "🔑"),
    ctx("buying", "🏠"),
    ctx("investment", "📈"),
    ctx("new_construction", "🏗️"),
  ],
  mechanic: [ctx("emergency", "🚑"), ctx("routine_service", "🔧"), ctx("pre_purchase_check", "🔍")],
  travel: [ctx("weekend_trip", "🎒"), ctx("family_vacation", "🏖️"), ctx("business_travel", "💼")],
  fitness: [ctx("beginner", "🌱"), ctx("personal_training", "🏋️"), ctx("rehab", "🩹")],
  technology: [ctx("startup", "🚀"), ctx("freelance_project", "💻"), ctx("enterprise", "🏢")],
  accountant: [ctx("small_business", "🏪"), ctx("personal_taxes", "🧾"), ctx("startup", "🚀")],
};

/** Contexts to offer for a topic — topic-specific first, then generic (deduped). */
export function contextsForTopic(topic: string): ContextOption[] {
  const specific = CONTEXTS_BY_TOPIC[topic] ?? [];
  const seen = new Set(specific.map((c) => c.value));
  return [...specific, ...DEFAULT_CONTEXTS.filter((c) => !seen.has(c.value))];
}
