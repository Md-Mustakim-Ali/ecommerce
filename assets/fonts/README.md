# Fonts for the PDF invoice

Four subsets of **Noto Sans Bengali**, used by `lib/orders/invoice-pdf.ts`.

| File | Covers |
|---|---|
| `noto-sans-bengali-latin-400.woff` | A–Z, digits, punctuation, dashes |
| `noto-sans-bengali-latin-600.woff` | the same, bold |
| `noto-sans-bengali-bengali-400.woff` | Bengali letters **and ৳** (U+09F3) |
| `noto-sans-bengali-bengali-600.woff` | the same, bold |

Both scripts come from one family, so mixing them mid-line is seamless.

## Why these are committed rather than read from node_modules

They were originally resolved out of `@fontsource/noto-sans-bengali` with
`require.resolve`. Turbopack sees a literal module specifier there, tries to
bundle a `.woff` as a JavaScript module, and fails the request with *"Unknown
module type"* — at runtime, on the download route, not at build time.

Reading them from a path under the repository sidesteps the bundler entirely:
these are runtime assets, not modules, and `fs.readFileSync` is the honest way
to say so. 137 KB total.

Note this assumes the repository is present at runtime, which it is under
`pnpm start` on Render. Switching to `output: "standalone"` would need these
added to the trace, since nothing imports them in a way a bundler can see.

## Why a PDF needs them at all

PDF's fourteen built-in fonts are Latin-only. Without an embedded Unicode font
a product named `শার্ট` prints as nothing, and `৳` vanishes from every total —
on the document a buyer keeps for a warranty claim.

## Provenance and licence

Extracted from `@fontsource/noto-sans-bengali` **5.3.0**, which packages the
Google Noto fonts unmodified.

Licensed under the **SIL Open Font License 1.1** — see `LICENSE` in this
directory. The OFL permits bundling and redistribution with software; the only
real obligation is keeping the licence alongside the fonts, which is why it is
here.

To update: reinstall that package at the new version and re-copy the four
`*-{latin,bengali}-{400,600}-normal.woff` files from its `files/` directory.
