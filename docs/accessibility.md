# Accessibility

What is checked automatically, what was checked by hand, and what is knowingly
not done.

```bash
pnpm verify:a11y
```

Parses the server-rendered HTML for every important route. It runs against a
dev server, so start one first.

---

## Checked automatically

`scripts/verify-accessibility.ts`, on ten routes including the 404:

| Rule | Why it is worth failing a build over |
|---|---|
| `img-alt` | An image with no `alt` is announced as its filename, or skipped |
| `link-name` / `button-name` | An icon-only control with no label is announced as "button" |
| `input-label` | A field with no label cannot be filled in without sighted guessing |
| `h1-count` | More than one h1, or none, breaks navigating a page by heading |
| `heading-skip` | h2 → h4 implies a level that is not there |
| `no-main` | Skip-to-content has nowhere to go |
| `no-lang` | The wrong synthesiser voice reads the whole page |
| `duplicate-id` | Silently breaks `for` and `aria-labelledby` while looking fine |
| `positive-tabindex` | Any positive value reorders the whole document's tab order |

Two things it found that were real:

- The **product card's image link** had no accessible name when a product has
  no photo — nothing inside it but an empty div. No seeded product lacks an
  image, so nothing on screen ever showed it. The image link is now
  `aria-hidden` and out of the tab order, because the title beneath links to
  the same product: one accessible link per card instead of two identical ones,
  and forty-eight tab stops in a grid became twenty-four.
- The **404 and error pages** had no `<main>`. They render outside the shop
  layout, so the layout's landmark was not there to inherit.

One thing it reported that was **not** real: the theme toggle's three radios,
flagged as unlabelled because the check only looked for `<label for>`. They use
a wrapping `<label>` with an `sr-only` span, which is equally valid. The check
was wrong and was fixed; a checker that cries wolf gets ignored, and then the
real failure gets waved through too.

## Checked by hand

**Keyboard-only pass on checkout.** Twenty focusable elements, every one with
an accessible name, in this order: header → email → name → address → city →
region → postcode → country → phone → discount code → apply → place order →
footer. No traps, nothing reachable only by mouse, and the fields follow the
order a person writes an address in rather than the order the markup happened
to be built in.

**Error announcement on checkout.** Both the per-field errors and the
form-level one are `role="alert"`, so a failed submit is spoken rather than
silently rendered above the fold.

**Reduced motion.** The card-to-page morph is skipped entirely, not shortened.
A scaled, travelling image is precisely what that setting is asking not to see.
The theme toggle's circular reveal is skipped the same way. Both still change
the thing they change; only the animation goes.

**Zoom.** No `maximum-scale` in the viewport meta, so pinch-zoom works. That is
an accessibility requirement, not a bug to be fixed with `user-scalable=no`.

## Not done

- **Contrast has not been measured against every token pair.** The palette was
  designed for it and `lib/design/tokens.test.ts` pins the values, but nothing
  computes a ratio. A real audit would.
- **No screen reader was actually run.** The structure is correct and the names
  are present; whether the resulting announcements are *pleasant* to listen to
  is a judgement only a person using one can make.
- **Dashboard and admin routes are not in the automated sweep**, because they
  need a session. The same rules apply to them and they have not been checked.
