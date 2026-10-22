/**
 * The theming a seller is allowed to choose.
 *
 * A fixed palette rather than a colour picker. Every value here has been
 * checked for contrast against both the light and dark surfaces; an arbitrary
 * hex has not, and a seller who picks pale yellow makes their own buttons
 * unreadable and reasonably blames the platform for it.
 *
 * Lives outside lib/actions because a `"use server"` module may only export
 * async functions — every export there becomes a callable endpoint, and a
 * colour table has no business being one.
 */

export const STORE_ACCENTS = [
  { value: "amber", label: "Amber", hex: "#f9a31e" },
  { value: "clay", label: "Clay", hex: "#c2683c" },
  { value: "moss", label: "Moss", hex: "#5a7d42" },
  { value: "slate", label: "Slate", hex: "#5b6b7f" },
  { value: "plum", label: "Plum", hex: "#7c5a86" },
  { value: "teal", label: "Teal", hex: "#3d7f7a" },
] as const;

export type StoreAccent = (typeof STORE_ACCENTS)[number]["value"];

export const ACCENT_VALUES = STORE_ACCENTS.map((a) => a.value) as [
  StoreAccent,
  ...StoreAccent[],
];

export function accentHex(value: string | null): string | null {
  return STORE_ACCENTS.find((a) => a.value === value)?.hex ?? null;
}

/**
 * Layout presets.
 *
 * These change how a store's own shopfront is arranged — nothing else. The
 * product page, cart and checkout are identical across every store, because a
 * shopper who has to relearn where the buy button is on each seller's page
 * buys from fewer of them.
 */
export const LAYOUT_PRESETS = [
  {
    value: "classic",
    label: "Classic",
    description: "A dense grid. Best when the catalogue is large.",
  },
  {
    value: "editorial",
    label: "Editorial",
    description:
      "Larger images, fewer per row. Suits a small, considered range.",
  },
  {
    value: "gallery",
    label: "Gallery",
    description: "Square tiles, no text until hover. For visual products.",
  },
] as const;

export type LayoutPreset = (typeof LAYOUT_PRESETS)[number]["value"];
