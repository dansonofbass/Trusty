/**
 * Provider/Place ontology — the curated catalog of things you can trust.
 *
 * Standard ontology modelling: a node keeps a small *base* rendering kind
 * (`person` | `location`) plus a semantic `entityType` (restaurant, property, …)
 * and typed `properties` validated against that type's schema. So every domain
 * works through one schema-driven path — adding a home lets you fill in every
 * property the `property` type declares, and a doctor gets a doctor's fields.
 *
 * Each entity type maps to a Trust Scope `topic` (see ./trust), so trust + search
 * line up with the ontology.
 */
import { refreshDerived } from "./recommend";
import type { Dataset, GNode, NodeType } from "./types";
import { registerBuiltins, entityTypeById, entityTypesForApp, BUILTIN_APP } from "./ontologyRegistry";
// Re-export the registry surface so the ontology module stays the public entry point.
export {
  entityTypeById,
  topicForEntityType,
  appForEntityType,
  entityTypesForApp,
  relationsForApp,
  allApps,
  allEntityTypes,
  allRelations,
  appBySlug,
  getOntology,
  setCustomOntology,
  getCustomOntology,
  scopeToApp,
  BUILTIN_APP,
} from "./ontologyRegistry";
export type { AppDef, CustomOntology } from "./ontologyRegistry";

export type OntologyDomain =
  | "food"
  | "health"
  | "legal"
  | "real_estate"
  | "home_services"
  | "finance"
  | "immigration"
  | "shopping"
  | "travel";

export const DOMAIN_LABEL: Record<string, string> = {
  food: "Food & Dining",
  health: "Health",
  legal: "Legal",
  real_estate: "Real Estate",
  home_services: "Home & Auto Services",
  finance: "Finance",
  immigration: "Immigration",
  shopping: "Shopping",
  travel: "Travel",
};

export type FieldType = "text" | "number" | "money" | "boolean" | "select" | "multiselect" | "geo";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** For select / multiselect. */
  options?: string[];
  /** For number / money — a unit hint shown in the UI. */
  unit?: string;
  placeholder?: string;
}

export interface EntityTypeDef {
  id: string;
  label: string;
  /**
   * The App (= Space = URL namespace) this type belongs to. Omitted on code-defined
   * built-ins (they default to the "general" app); admin-defined types set it.
   */
  app?: string;
  /** UI grouping within an app (a category). Built-ins reuse their original domain. */
  domain: string;
  /** Rendering node kind: an individual professional (person) or a place/business. */
  baseType: Extract<NodeType, "person" | "location">;
  /** Trust Scope topic this entity is trusted under. */
  topic: string;
  /** Typed property schema — drives the "add entity" form + the inspector. */
  fields: FieldDef[];
}

/** A relationship the ontology allows between entity types (the relation vocabulary). */
export interface RelationDef {
  id: string;
  label: string;
  /** Owning App slug (omitted on built-ins → "general"). */
  app?: string;
  /** Allowed source/target entityType ids ("*" = any entity, "city" = a location). */
  from: string[];
  to: string[];
}

/* ------------------------------------------------------------------ */
/* Shared field fragments                                              */
/* ------------------------------------------------------------------ */

const GEO: FieldDef = { key: "geo", label: "Area / City", type: "geo", placeholder: "e.g. Yerevan · Arabkir" };
const LANGUAGES: FieldDef = {
  key: "languages",
  label: "Languages",
  type: "multiselect",
  options: ["english", "armenian", "russian", "persian", "french", "arabic"],
};
const PRICE_RANGE: FieldDef = { key: "price_range", label: "Price range", type: "select", options: ["$", "$$", "$$$", "$$$$"] };
const EMERGENCY: FieldDef = { key: "emergency_service", label: "24/7 emergency", type: "boolean" };
// Contact + hours — populated by places connectors (OSM/Google/Yandex tags).
const HOURS: FieldDef = { key: "hours", label: "Opening hours", type: "text", placeholder: "e.g. Mo-Su 09:00-23:00" };
const CONTACT: FieldDef[] = [
  HOURS,
  { key: "address", label: "Address", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "website", label: "Website", type: "text" },
];
// Dining facts (populated by connectors, admin, or user suggestions). Big
// multiselects surfaced as a "features" grid on the restaurant detail modal.
const MEAL_TYPES: FieldDef = {
  key: "meal_types",
  label: "Meal types",
  type: "multiselect",
  options: ["breakfast", "brunch", "lunch", "dinner", "late_night", "dessert", "coffee", "drinks"],
};
const AMENITIES: FieldDef = {
  key: "amenities",
  label: "Amenities",
  type: "multiselect",
  options: [
    "accepts_cards", "digital_payments", "wifi", "free_wifi", "outdoor_seating", "indoor_seating",
    "parking", "street_parking", "takeaway", "delivery", "drive_through", "full_bar", "serves_alcohol",
    "wine_beer", "live_music", "tv", "air_conditioning", "table_service", "reservations",
    "wheelchair_accessible", "non_smoking", "dog_friendly", "family_style", "private_dining",
    "highchairs",
  ],
};
// Cuisines — extended to cover common OSM/Yandex values for the region
// (regional/caucasian/… were previously dropped on import).
const CUISINE: FieldDef = {
  key: "cuisine",
  label: "Cuisine",
  type: "multiselect",
  options: [
    "armenian", "georgian", "persian", "russian", "caucasian", "regional", "middle_eastern",
    "lebanese", "turkish", "greek", "mediterranean", "european", "eastern_european", "international",
    "italian", "pizza", "french", "japanese", "sushi", "chinese", "asian", "thai", "indian",
    "mexican", "american", "barbecue", "seafood", "steakhouse", "fast_food", "vegetarian", "vegan",
  ],
};
const CAPACITY: FieldDef = { key: "capacity", label: "Capacity", type: "number", unit: "seats" };

/* ------------------------------------------------------------------ */
/* The entity types (the node ontology)                                */
/* ------------------------------------------------------------------ */

export const ENTITY_TYPES: EntityTypeDef[] = [
  // ── Food ──────────────────────────────────────────────────────
  {
    id: "restaurant",
    label: "Restaurant",
    domain: "food",
    baseType: "location",
    topic: "restaurant",
    fields: [
      CUISINE,
      PRICE_RANGE,
      MEAL_TYPES,
      { key: "good_for", label: "Good for", type: "multiselect", options: ["date_night", "family", "business", "quick_bite", "groups", "solo"] },
      { key: "dietary", label: "Dietary", type: "multiselect", options: ["vegetarian", "vegan", "halal", "kosher", "gluten_free"] },
      CAPACITY,
      { key: "outdoor_seating", label: "Outdoor seating", type: "boolean" },
      { key: "reservations", label: "Takes reservations", type: "boolean" },
      AMENITIES,
      ...CONTACT,
      GEO,
    ],
  },
  {
    id: "cafe",
    label: "Cafe",
    domain: "food",
    baseType: "location",
    topic: "cafe",
    fields: [
      { key: "specialty", label: "Specialty", type: "multiselect", options: ["coffee", "brunch", "bakery", "tea", "desserts"] },
      PRICE_RANGE,
      MEAL_TYPES,
      { key: "wifi", label: "Wi-Fi", type: "boolean" },
      { key: "power_outlets", label: "Power outlets", type: "boolean" },
      { key: "laptop_friendly", label: "Laptop friendly", type: "boolean" },
      { key: "quiet", label: "Quiet", type: "boolean" },
      AMENITIES,
      ...CONTACT,
      GEO,
    ],
  },

  // ── Health ────────────────────────────────────────────────────
  {
    id: "doctor",
    label: "Doctor",
    domain: "health",
    baseType: "person",
    topic: "doctor",
    fields: [
      { key: "specialty", label: "Specialty", type: "select", options: ["general", "cardiology", "dermatology", "pediatrics", "orthopedics", "gynecology", "neurology", "psychiatry", "ophthalmology"] },
      LANGUAGES,
      { key: "accepts_insurance", label: "Accepts insurance", type: "boolean" },
      { key: "clinic", label: "Clinic / Hospital", type: "text" },
      GEO,
    ],
  },
  {
    id: "dentist",
    label: "Dentist",
    domain: "health",
    baseType: "person",
    topic: "dentist",
    fields: [
      { key: "specialty", label: "Specialty", type: "select", options: ["general", "orthodontics", "implants", "cosmetic", "pediatric", "surgery"] },
      LANGUAGES,
      { key: "accepts_insurance", label: "Accepts insurance", type: "boolean" },
      { key: "clinic", label: "Clinic", type: "text" },
      GEO,
    ],
  },

  // ── Legal ─────────────────────────────────────────────────────
  {
    id: "lawyer",
    label: "Lawyer",
    domain: "legal",
    baseType: "person",
    topic: "lawyer",
    fields: [
      { key: "practice_area", label: "Practice areas", type: "multiselect", options: ["immigration", "corporate", "family", "criminal", "real_estate", "tax", "labor", "ip"] },
      LANGUAGES,
      { key: "firm", label: "Firm", type: "text" },
      { key: "hourly_rate", label: "Hourly rate", type: "money", unit: "USD/hr" },
      GEO,
    ],
  },
  {
    id: "accountant",
    label: "Accountant",
    domain: "finance",
    baseType: "person",
    topic: "accountant",
    fields: [
      { key: "services", label: "Services", type: "multiselect", options: ["tax", "bookkeeping", "payroll", "audit", "company_formation", "advisory"] },
      LANGUAGES,
      { key: "firm", label: "Firm", type: "text" },
      GEO,
    ],
  },

  // ── Real estate ───────────────────────────────────────────────
  {
    id: "broker",
    label: "Real-estate Broker",
    domain: "real_estate",
    baseType: "person",
    topic: "broker",
    fields: [
      { key: "specialization", label: "Specialization", type: "multiselect", options: ["rent", "sale", "residential", "commercial", "luxury", "land"] },
      LANGUAGES,
      { key: "agency", label: "Agency", type: "text" },
      { key: "commission_pct", label: "Commission", type: "number", unit: "%" },
      GEO,
    ],
  },
  {
    id: "property",
    label: "Property / Home",
    domain: "real_estate",
    baseType: "location",
    topic: "real_estate",
    fields: [
      { key: "listing_type", label: "Listing", type: "select", options: ["rent", "sale"] },
      { key: "property_type", label: "Type", type: "select", options: ["apartment", "house", "studio", "villa", "office", "land", "commercial"] },
      { key: "price", label: "Price", type: "money", unit: "USD" },
      { key: "bedrooms", label: "Bedrooms", type: "number" },
      { key: "bathrooms", label: "Bathrooms", type: "number" },
      { key: "area_sqm", label: "Area", type: "number", unit: "m²" },
      { key: "floor", label: "Floor", type: "number" },
      { key: "furnished", label: "Furnished", type: "boolean" },
      { key: "parking", label: "Parking", type: "boolean" },
      { key: "pets_allowed", label: "Pets allowed", type: "boolean" },
      { key: "amenities", label: "Amenities", type: "multiselect", options: ["balcony", "elevator", "heating", "ac", "garden", "pool", "security", "storage"] },
      { key: "available_from", label: "Available from", type: "text", placeholder: "YYYY-MM" },
      GEO,
    ],
  },

  // ── Home & auto services ──────────────────────────────────────
  {
    id: "mechanic",
    label: "Mechanic",
    domain: "home_services",
    baseType: "person",
    topic: "mechanic",
    fields: [
      { key: "services", label: "Services", type: "multiselect", options: ["engine", "tires", "electrical", "bodywork", "diagnostics", "ac"] },
      { key: "vehicle_types", label: "Vehicles", type: "multiselect", options: ["car", "motorcycle", "truck", "ev"] },
      { key: "shop", label: "Shop", type: "text" },
      GEO,
    ],
  },
  {
    id: "plumber",
    label: "Plumber",
    domain: "home_services",
    baseType: "person",
    topic: "plumber",
    fields: [
      { key: "services", label: "Services", type: "multiselect", options: ["leaks", "installation", "drainage", "heating", "water_heater", "renovation"] },
      EMERGENCY,
      GEO,
    ],
  },
  {
    id: "electrician",
    label: "Electrician",
    domain: "home_services",
    baseType: "person",
    topic: "electrician",
    fields: [
      { key: "services", label: "Services", type: "multiselect", options: ["wiring", "panels", "lighting", "appliances", "ev_charger", "inspection"] },
      EMERGENCY,
      GEO,
    ],
  },

  // ── Immigration ───────────────────────────────────────────────
  {
    id: "immigration_consultant",
    label: "Immigration Consultant",
    domain: "immigration",
    baseType: "person",
    topic: "immigration",
    fields: [
      { key: "services", label: "Services", type: "multiselect", options: ["residency", "citizenship", "work_permit", "visa", "asylum", "company_immigration"] },
      { key: "countries", label: "Countries", type: "multiselect", options: ["armenia", "georgia", "uae", "portugal", "canada", "germany", "usa"] },
      LANGUAGES,
      { key: "firm", label: "Firm", type: "text" },
      GEO,
    ],
  },

  // ── Shopping ──────────────────────────────────────────────────
  {
    id: "shop",
    label: "Shop / Store",
    domain: "shopping",
    baseType: "location",
    topic: "shopping",
    fields: [
      { key: "category", label: "Category", type: "select", options: ["grocery", "electronics", "clothing", "furniture", "pharmacy", "books", "hardware", "specialty"] },
      PRICE_RANGE,
      { key: "delivery", label: "Delivery", type: "boolean" },
      GEO,
    ],
  },

  // ── Travel ────────────────────────────────────────────────────
  {
    id: "travel_agency",
    label: "Travel Agency",
    domain: "travel",
    baseType: "location",
    topic: "travel",
    fields: [
      { key: "services", label: "Services", type: "multiselect", options: ["flights", "tours", "hotels", "visas", "cruises", "car_rental"] },
      { key: "destinations", label: "Destinations", type: "multiselect", options: ["europe", "asia", "middle_east", "americas", "africa", "domestic"] },
      GEO,
    ],
  },
  {
    id: "hotel",
    label: "Hotel / Stay",
    domain: "travel",
    baseType: "location",
    topic: "travel",
    fields: [
      { key: "stars", label: "Stars", type: "number", unit: "★" },
      PRICE_RANGE,
      { key: "amenities", label: "Amenities", type: "multiselect", options: ["wifi", "pool", "breakfast", "parking", "gym", "spa", "pet_friendly"] },
      GEO,
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Relation ontology (the edge vocabulary between entities)            */
/* ------------------------------------------------------------------ */

export const RELATION_TYPES: RelationDef[] = [
  { id: "LOCATED_IN", label: "is located in", from: ["*"], to: ["city"] },
  { id: "WORKS_AT", label: "works at", from: ["doctor", "dentist", "lawyer", "broker", "accountant"], to: ["*"] },
  { id: "LISTED_BY", label: "is listed by", from: ["property"], to: ["broker"] },
  { id: "MANAGES", label: "manages", from: ["broker"], to: ["property"] },
  { id: "REFERS", label: "refers to", from: ["*"], to: ["*"] },
  { id: "NEAR", label: "is near", from: ["*"], to: ["*"] },
  { id: "PROVIDES_FOR", label: "provides service for", from: ["*"], to: ["*"] },
];

/* ------------------------------------------------------------------ */
/* Lookups + helpers                                                   */
/* ------------------------------------------------------------------ */

/** Register the code-defined built-ins as the "general" app (runs once at init). */
registerBuiltins(ENTITY_TYPES, RELATION_TYPES);

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Entity types grouped by category (the Add-Entity form sections), for one App.
 * Defaults to the built-in "general" app; pass an app slug to browse a custom app.
 * Registry-driven, so admin-defined types appear here with zero code change.
 */
export function entityTypesByDomain(
  app: string = BUILTIN_APP,
): { domain: string; label: string; types: EntityTypeDef[] }[] {
  const types = entityTypesForApp(app);
  const seen: string[] = [];
  for (const t of types) if (!seen.includes(t.domain)) seen.push(t.domain);
  const curated = ["food", "real_estate", "health", "legal", "home_services", "finance", "immigration", "shopping", "travel"];
  const order =
    app === BUILTIN_APP
      ? curated.filter((d) => seen.includes(d)).concat(seen.filter((d) => !curated.includes(d)))
      : seen;
  return order.map((domain) => ({
    domain,
    label: (DOMAIN_LABEL as Record<string, string>)[domain] ?? titleCase(domain),
    types: types.filter((e) => e.domain === domain),
  }));
}

/** Coerce + validate raw form values against an entity type's schema. */
export function validateEntityProperties(
  entityType: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const def = entityTypeById(entityType);
  if (!def) return {};
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === "") continue;
    switch (f.type) {
      case "number":
      case "money": {
        const n = Number(v);
        if (Number.isFinite(n)) out[f.key] = n;
        break;
      }
      case "boolean":
        out[f.key] = Boolean(v);
        break;
      case "multiselect": {
        const arr = Array.isArray(v) ? v.map(String) : [String(v)];
        const allowed = f.options ? arr.filter((x) => f.options!.includes(x)) : arr;
        if (allowed.length) out[f.key] = allowed;
        break;
      }
      case "select": {
        const s = String(v);
        if (!f.options || f.options.includes(s)) out[f.key] = s;
        break;
      }
      default:
        out[f.key] = String(v);
    }
  }
  return out;
}

/** A compact one-line descriptor for the node `sub` (e.g. "Property · rent · Yerevan"). */
function describe(def: EntityTypeDef, props: Record<string, unknown>): string {
  const bits: string[] = [def.label];
  const head = def.fields[0];
  if (head && props[head.key] != null) {
    const v = props[head.key];
    bits.push(Array.isArray(v) ? v.join("/") : String(v));
  }
  if (props.geo) bits.push(String(props.geo));
  return bits.join(" · ");
}

let entitySeq = 0;

/**
 * Create an ontology entity as a graph node (validated properties + base kind +
 * trust topic). Returns the refreshed dataset. `now` is passed in so graph-core
 * stays deterministic.
 */
export function createEntity(
  d: Dataset,
  input: { entityType: string; label: string; properties?: Record<string, unknown>; now: number },
): { dataset: Dataset; nodeId: string } {
  const def = entityTypeById(input.entityType);
  if (!def) throw new Error(`unknown entity type: ${input.entityType}`);
  const label = input.label.trim();
  if (!label) throw new Error("entity needs a name");
  const properties = validateEntityProperties(input.entityType, input.properties ?? {});
  const id = `en_${input.now.toString(36)}${(entitySeq++ % 36).toString(36)}`;
  const node: GNode = {
    id,
    type: def.baseType,
    label,
    sub: describe(def, properties),
    clusters: [],
    // Treat ontology people as public figures (linkable/trustable, not social accounts).
    figure: def.baseType === "person" ? true : undefined,
    entityType: def.id,
    properties,
  };
  return { dataset: refreshDerived({ ...d, nodes: [...d.nodes, node] }), nodeId: id };
}

/**
 * Update an existing ontology entity's label and/or properties (admin edits and
 * approved user suggestions). `properties` are validated against the node's
 * entityType schema and MERGED over the current ones (so a partial patch only
 * changes the keys it names). Returns the refreshed dataset. Deterministic.
 */
export function updateEntity(
  d: Dataset,
  input: { id: string; label?: string; properties?: Record<string, unknown>; now: number },
): Dataset {
  const node = d.nodes.find((n) => n.id === input.id);
  if (!node) throw new Error(`unknown node: ${input.id}`);
  if (!node.entityType) throw new Error("not an ontology entity");
  const def = entityTypeById(node.entityType);
  if (!def) throw new Error(`unknown entity type: ${node.entityType}`);

  const label = input.label?.trim() || node.label;
  const patch = input.properties ? validateEntityProperties(node.entityType, input.properties) : {};
  const properties = { ...(node.properties ?? {}), ...patch };
  const updated: GNode = { ...node, label, properties, sub: describe(def, properties) };
  return refreshDerived({ ...d, nodes: d.nodes.map((n) => (n.id === input.id ? updated : n)) });
}

/**
 * Turn an existing person node into (or update) an ontology PROFILE.
 *
 * ONE PERSON, MANY ROLES: a person may activate any number of person-type roles
 * (founder AND mentor AND investor…). `roles[0]` is the PRIMARY role — it becomes
 * the node's `entityType` (what the graph/canvas shows); the full set is stored
 * as `properties.active_roles`, and the property patch is validated against the
 * UNION of all active roles' schemas (so a founder+mentor keeps both field sets).
 * Backward compatible: a single `entityType` behaves as one active role.
 * Unlike `updateEntity`, this accepts a plain social person with no `entityType`
 * yet, and does NOT mark them a `figure`. Deterministic.
 */
export function upsertProfile(
  d: Dataset,
  input: {
    personId: string;
    entityType?: string;
    /** Active roles, primary first. Overrides `entityType` when non-empty. */
    roles?: string[];
    label?: string;
    properties?: Record<string, unknown>;
    now: number;
  },
): Dataset {
  const node = d.nodes.find((n) => n.id === input.personId);
  if (!node) throw new Error(`unknown node: ${input.personId}`);
  const roleIds = [...new Set((input.roles?.length ? input.roles : [input.entityType]).filter(Boolean) as string[])];
  const defs = roleIds.map((r) => {
    const def = entityTypeById(r);
    if (!def) throw new Error(`unknown entity type: ${r}`);
    if (def.baseType !== "person") throw new Error("a profile must use person entity types");
    return def;
  });
  if (defs.length === 0) throw new Error("a profile needs at least one role");

  // Union-validate: each role keeps the fields its schema knows about.
  const patch: Record<string, unknown> = {};
  for (const def of defs) Object.assign(patch, validateEntityProperties(def.id, input.properties ?? {}));

  const properties: Record<string, unknown> = { ...(node.properties ?? {}), ...patch, active_roles: roleIds };
  // First profile save = "joined" — powers Recently Joined feeds. Never overwritten.
  if (properties.joined_at == null) properties.joined_at = input.now;
  const label = input.label?.trim() || node.label;
  const primary = defs[0];
  const sub =
    defs.length > 1
      ? `${defs.map((x) => x.label).join(" · ")}`
      : describe(primary, properties);
  const updated: GNode = { ...node, label, entityType: primary.id, properties, sub };
  return refreshDerived({ ...d, nodes: d.nodes.map((n) => (n.id === input.personId ? updated : n)) });
}

/** All roles a node is active in (primary entityType + active_roles). */
export function activeRolesOf(n: GNode): string[] {
  const extra = Array.isArray(n.properties?.active_roles) ? (n.properties!.active_roles as string[]).map(String) : [];
  return [...new Set([...(n.entityType ? [n.entityType] : []), ...extra])];
}

/** Does this node act in `role` (its primary entityType OR any active role)? */
export function hasRole(n: GNode, role: string): boolean {
  if (n.entityType === role) return true;
  const extra = n.properties?.active_roles;
  return Array.isArray(extra) && extra.map(String).includes(role);
}
