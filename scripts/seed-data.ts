/**
 * Static fixture data for the development seed.
 *
 * Realistic volume matters: 200 products is enough to expose the pagination,
 * virtualisation and query-plan problems that 12 products hide until launch.
 */

export const CATEGORY_TREE = [
  {
    name: "Electronics",
    children: [
      { name: "Audio", children: ["Headphones", "Speakers", "Turntables"] },
      {
        name: "Computing",
        children: ["Keyboards", "Monitors", "Laptop stands"],
      },
    ],
  },
  {
    name: "Home",
    children: [
      { name: "Kitchen", children: ["Cookware", "Coffee", "Storage"] },
      { name: "Living", children: ["Lighting", "Textiles", "Shelving"] },
    ],
  },
  {
    name: "Apparel",
    children: [
      { name: "Outerwear", children: ["Jackets", "Overshirts", "Knitwear"] },
      { name: "Accessories", children: ["Bags", "Belts", "Hats"] },
    ],
  },
  {
    name: "Stationery",
    children: [
      { name: "Paper", children: ["Notebooks", "Cards", "Refills"] },
      { name: "Writing", children: ["Pens", "Pencils", "Ink"] },
    ],
  },
] as const;

export const BRANDS = [
  "Aureus",
  "Northmark",
  "Kestrel & Co",
  "Palladio",
  "Verdant Supply",
  "Hollowbrook",
  "Studio Meridian",
  "Fenwick",
  "Alto Standard",
  "Bramble",
  "Cormorant",
  "Dunlin Works",
  "Everley",
  "Fathom",
  "Grayling",
  "Harrowgate",
  "Ironwood",
  "Juniper Lane",
  "Kilnhouse",
  "Lampwick",
] as const;

/**
 * Deliberately near-duplicates of approved brands, left pending so the admin
 * queue has something real to merge and the trigram warning has something to
 * catch. This is the exact failure the deduplication workflow exists for.
 */
export const PENDING_BRANDS = [
  "Northmark Supply", // near "Northmark"
  "Kestrel and Co", // slugs to kestrel-and-co, same as "Kestrel & Co"
  "Aureus Design",
  "Verdent Supply", // misspelling of "Verdant Supply"
  "Bramble Home",
] as const;

export const TAGS = [
  "handmade",
  "recycled",
  "limited edition",
  "waterproof",
  "wireless",
  "organic cotton",
  "stainless steel",
  "solid oak",
  "made in EU",
  "vegan",
  "dishwasher safe",
  "noise cancelling",
  "fast charging",
  "machine washable",
  "small batch",
  "refillable",
  "unisex",
  "lightweight",
  "heavyweight",
  "matte finish",
] as const;

export const PENDING_TAGS = [
  "hand made", // slugs differently from "handmade"; a merge candidate
  "water proof",
  "noise-cancelling",
] as const;

export const STORES = [
  {
    name: "Northmark Supply",
    slug: "northmark-supply",
    description: "Workwear and outerwear built to be repaired, not replaced.",
    accentColor: "#8b5a2b",
    layoutPreset: "classic",
    owner: { name: "Ida Nordmark", email: "ida@northmark.test" },
  },
  {
    name: "Oakline",
    slug: "oakline",
    description: "Solid timber desk objects, made in small batches.",
    accentColor: "#6b7f5a",
    layoutPreset: "editorial",
    owner: { name: "Tomas Oak", email: "tomas@oakline.test" },
  },
  {
    name: "Paper & Press",
    slug: "paper-and-press",
    description: "Notebooks, cards and refills for people who still write.",
    accentColor: "#4a5568",
    layoutPreset: "gallery",
    owner: { name: "Rosa Pressley", email: "rosa@paperpress.test" },
  },
  {
    name: "Halden Home",
    slug: "halden-home",
    description: "Textiles and lighting for rooms you actually live in.",
    accentColor: "#a45c5c",
    layoutPreset: "classic",
    owner: { name: "Nils Halden", email: "nils@halden.test" },
  },
  {
    name: "Circuit & Cabinet",
    slug: "circuit-and-cabinet",
    description: "Audio equipment, restored and guaranteed.",
    accentColor: "#3d5a80",
    layoutPreset: "editorial",
    owner: { name: "Yuki Tanaka", email: "yuki@circuitcabinet.test" },
  },
] as const;

/** Staff added to the first store, so the role system has real data behind it. */
export const STAFF = [
  { name: "Petra Vance", email: "petra@northmark.test", roleSlug: "manager" },
  { name: "Sam Okonkwo", email: "sam@northmark.test", roleSlug: "fulfilment" },
  { name: "Lena Fischer", email: "lena@northmark.test", roleSlug: "catalog" },
] as const;

export const ADMIN = {
  name: "Platform Admin",
  email: "admin@marketplace.test",
  roleSlug: "super-admin",
} as const;

export const BUYERS = [
  { name: "Ada Reyes", email: "ada@buyer.test" },
  { name: "Malik Haddad", email: "malik@buyer.test" },
] as const;

/** Everything seeded shares this password. Local development only. */
export const SEED_PASSWORD = "seed-password-1234";

const ADJECTIVES = [
  "Merino",
  "Waxed",
  "Brushed",
  "Solid",
  "Washed",
  "Heavyweight",
  "Compact",
  "Folding",
  "Insulated",
  "Reclaimed",
  "Hand-turned",
  "Enamelled",
  "Ribbed",
  "Quilted",
  "Perforated",
  "Tapered",
  "Stacking",
  "Adjustable",
];

const MATERIALS = [
  "wool",
  "oak",
  "linen",
  "steel",
  "brass",
  "canvas",
  "cork",
  "walnut",
  "ceramic",
  "leather",
  "aluminium",
  "cotton",
];

const NOUNS: Record<string, string[]> = {
  Headphones: ["over-ear headphones", "monitoring headphones", "earphones"],
  Speakers: ["bookshelf speaker", "portable speaker", "desktop monitor"],
  Turntables: ["belt-drive turntable", "record cleaning kit", "cartridge"],
  Keyboards: ["mechanical keyboard", "keycap set", "wrist rest"],
  Monitors: ["monitor riser", "display arm", "screen hood"],
  "Laptop stands": ["laptop stand", "docking tray", "cable arch"],
  Cookware: ["frying pan", "casserole dish", "stock pot"],
  Coffee: ["pour-over dripper", "hand grinder", "kettle"],
  Storage: ["storage jar", "bread bin", "canister set"],
  Lighting: ["table lamp", "pendant shade", "wall sconce"],
  Textiles: ["throw blanket", "cushion cover", "table runner"],
  Shelving: ["wall shelf", "shelf bracket", "shelving unit"],
  Jackets: ["chore jacket", "field jacket", "parka"],
  Overshirts: ["overshirt", "shacket", "work shirt"],
  Knitwear: ["crew jumper", "cardigan", "roll neck"],
  Bags: ["tote bag", "weekender", "messenger bag"],
  Belts: ["belt", "webbing belt", "buckle belt"],
  Hats: ["watch cap", "five-panel cap", "bucket hat"],
  Notebooks: ["dot grid notebook", "pocket notebook", "sketchbook"],
  Cards: ["greeting card set", "index cards", "postcard pack"],
  Refills: ["notebook refill", "planner insert", "loose-leaf pack"],
  Pens: ["rollerball pen", "fountain pen", "ballpoint pen"],
  Pencils: ["pencil set", "mechanical pencil", "carpenter pencil"],
  Ink: ["ink bottle", "ink cartridges", "ink sampler"],
};

export function productTitle(leafCategory: string, index: number): string {
  const nouns = NOUNS[leafCategory] ?? ["item"];
  const adjective = ADJECTIVES[index % ADJECTIVES.length];
  const material = MATERIALS[(index * 7) % MATERIALS.length];
  const noun = nouns[index % nouns.length];
  return `${adjective} ${material} ${noun}`;
}

export const COLOR_OPTIONS = ["Navy", "Charcoal", "Sand", "Olive", "Rust"];
export const SIZE_OPTIONS = ["S", "M", "L", "XL"];

/**
 * Global attributes.
 *
 * Deliberately includes one variant-driving pair (Size and Colour) and two
 * spec-only attributes, so both roles are exercised by real data.
 */
export type AttributeFixture = {
  slug: string;
  name: string;
  kind: "select" | "color" | "number" | "text";
  role: "variant" | "spec";
  values: { value: string; meta?: Record<string, unknown> }[];
};

export const ATTRIBUTES: AttributeFixture[] = [
  {
    slug: "size",
    name: "Size",
    kind: "select" as const,
    role: "variant" as const,
    values: [
      { value: "XS" },
      { value: "S" },
      { value: "M" },
      { value: "L" },
      { value: "XL" },
    ],
  },
  {
    slug: "colour",
    name: "Colour",
    kind: "color" as const,
    role: "variant" as const,
    values: [
      { value: "Navy", meta: { hex: "#1b2a4a" } },
      { value: "Charcoal", meta: { hex: "#36393f" } },
      { value: "Sand", meta: { hex: "#d8c8a9" } },
      { value: "Olive", meta: { hex: "#5a6144" } },
      { value: "Rust", meta: { hex: "#9c4a2f" } },
    ],
  },
  {
    slug: "material",
    name: "Material",
    kind: "select" as const,
    role: "spec" as const,
    values: [
      { value: "Merino wool" },
      { value: "Organic cotton" },
      { value: "Solid oak" },
      { value: "Stainless steel" },
      { value: "Linen" },
      { value: "Walnut" },
    ],
  },
  {
    slug: "ram",
    name: "RAM",
    kind: "select" as const,
    role: "variant" as const,
    values: [
      { value: "8 GB", meta: { numeric: 8 } },
      { value: "12 GB", meta: { numeric: 12 } },
      { value: "16 GB", meta: { numeric: 16 } },
    ],
  },
  {
    slug: "storage",
    name: "Storage",
    kind: "select" as const,
    role: "variant" as const,
    values: [
      { value: "128 GB", meta: { numeric: 128 } },
      { value: "256 GB", meta: { numeric: 256 } },
      { value: "512 GB", meta: { numeric: 512 } },
    ],
  },
  {
    slug: "made-in",
    name: "Made in",
    kind: "select" as const,
    role: "spec" as const,
    values: [
      { value: "Portugal" },
      { value: "Japan" },
      { value: "Italy" },
      { value: "Bangladesh" },
      { value: "United Kingdom" },
    ],
  },
];
