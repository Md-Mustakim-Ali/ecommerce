# UI brief

Requirements stated by the project owner. These are constraints, not
suggestions. Phase 1 turns them into tokens and components; Phase 3 turns them
into feel. Read alongside the "UI conventions" section of AGENTS.md.

---

## Non-negotiable

**Three colour modes.** Light, dark, and system. Not a dark-mode afterthought —
both themes are designed, and `system` is the default. Every token has a value
in both. Contrast is checked in both.

**Fully responsive.** Every screen works at every width, from a 320px phone to
an ultrawide desktop. No fixed breakpoint that a real device falls between.

**Alive, not loud.** The interface should respond to scrolling, pointer, and
touch in a way that feels fluid and physical. It should not feel like a
slideshow of entrance animations. Motion is feedback, not decoration.

**Not a typical ecommerce template.** Distinctive, but the distinctiveness has
to earn its place. Usability first; nothing clever at the cost of finding and
buying a product.

---

## Navigation

Different shape per breakpoint. Same information architecture underneath.

### Mobile (< 768px)

**Bottom bar — 5 slots, thumb-reachable, fixed.**

| Slot | Destination |
|---|---|
| Home | Storefront home |
| Search | Full-screen search with filters |
| Categories | Opens the retractable sidebar |
| Cart | Cart drawer, with item-count badge |
| Account | Orders, addresses, seller switch if they own a store |

The bar hides on scroll down and returns on scroll up, so it never fights a
product grid. It must not cover the add-to-cart button on a product page —
that button docks above it, not behind it.

**Retractable sidebar — the category tree.** Left-edge drawer, swipe to open and
to dismiss, velocity threshold. This is where the 3-level category tree lives,
plus brands and saved filters. It is a drill-down, not a mega-menu crammed into
a phone. Vaul, per AGENTS.md.

### Desktop (>= 1024px)

**Top navigation.** Confirmed as the right call — horizontal space is the
resource desktop has and mobile does not, and buyers scan a horizontal category
row faster than a vertical list.

Two rows that collapse into one on scroll:

- Row 1: logo, search (wide, always visible, never an icon that expands),
  account, cart.
- Row 2: top-level categories. Hovering one opens a single full-width panel
  with its subcategories and featured brands. One panel, not a cascade of
  nested flyouts.

On scroll, row 2 collapses and row 1 condenses into a slim sticky bar. CSS
scroll-driven animation, not a JavaScript scroll listener.

### Tablet (768–1023px)

Top navigation, but categories move behind a single trigger that opens the same
sidebar as mobile. No bottom bar.

### Seller dashboard and admin

Different problem. Persistent left sidebar at every width above mobile,
collapsible to icons. Dense, plain, fast. AGENTS.md: do not spend design effort
here.

---

## Direction — decided 2026-09-03

**Tactile / material.**

Layered surfaces separated by elevation and subtle tint rather than borders.
Larger radii and generous padding. Shadows are directional and respond to
pointer position rather than sitting flat under every card. Base is a
desaturated cool neutral; the accent is warm.

The target feel is a native app, not a web page. This is the direction that
matches "alive and fluid," and it front-loads work into Phase 3 — elevation and
pointer-reactive shadow are cheap to specify and expensive to get right at
60fps on a mid-range Android. Budget for that.

Constraints this direction inherits from AGENTS.md, which it must not violate:

- Elevation is a **token scale**, not per-component shadow values. If a
  component hardcodes a shadow, it is wrong.
- Not every surface is a card. AGENTS.md calls out "everything chopped into
  identical rounded cards" as a tell — elevation must be used to express
  actual hierarchy, so a promoted product and a filter panel do not sit at the
  same height.
- Pointer-reactive shadow is `transform`/`opacity` only, and it does not exist
  under `prefers-reduced-motion` or on touch.
- Both themes are designed. Dark mode is not the light ramp inverted; elevation
  in dark reads through surface lightness, not through shadow.

### Resolved during the token build

- **Typeface: Manrope** for UI and display, **JetBrains Mono** for prices,
  SKUs, order numbers and tracking codes. Both variable, so two font files.
- **Palette:** desaturated cool neutral base at hue ~258, warm amber accent at
  hue ~70. Every token is declared once with `light-dark()`.
- **Shape: controls are pills.** `--radius-control: 9999px` is shared by every
  interactive control so buttons, inputs, chips and selects agree. Panels use
  1.5–2.5rem. Tight radii were the main reason the first pass read as boxy.
- **Skeletons are layout-shaped**, not grey bars, and sweep rather than pulse.
  `ProductCardSkeleton` is pixel-identical to `ProductCard`.

### Verified, not asserted

`lib/design/tokens.test.ts` parses `app/globals.css` and fails the build if:

- body text drops below 4.5:1, or focus rings and control borders below 3:1,
  in either theme, on any surface
- any token falls outside the sRGB gamut and would be silently clipped
- the dark ramp stops ascending, which is how "dark mode is designed, not
  inverted" stays true
- the `<meta name="theme-color">` hexes drift from `--surface-0`

### Admin panel

Deliberately stock shadcn: monochrome, flat, small radius. Implemented as a
`.theme-admin` token override rather than a second component library — the same
Button renders warm and pill-shaped on the storefront and square and
monochrome inside the admin. Status colours stay coloured there, because a
failed payout has to read as failed.

### Still open

**Reference points.** Sites whose feel is right, and sites that read as
generic. Still the most useful missing input.
