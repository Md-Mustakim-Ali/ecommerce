/**
 * Slug normalisation. This is the deduplication key for brands and tags.
 *
 * "Samsung", "SAMSUNG ", "samsung" and "Samsung." all have to collapse to the
 * same slug, because the unique index on that slug is what stops the catalog
 * filling up with four spellings of one brand.
 */

/**
 * Combining Diacritical Marks (U+0300–U+036F) only.
 *
 * Deliberately NOT \p{M}, which would also match Bengali, Devanagari, Arabic
 * and Thai marks. Those are not decoration — stripping the vowel signs out of
 * a Bengali word changes what it says. This block covers the Latin, Greek and
 * Cyrillic accents we actually want folded, and nothing else.
 */
const LATIN_DIACRITICS = /[̀-ͯ]/g;

/**
 * Anything that is not a letter, a digit, or a combining mark becomes a
 * separator.
 *
 * \p{M} has to be in the keep-set. Bengali "আড়ং" is a letter, a nukta, and an
 * anusvara — both of those are marks, not letters, so a plain [^\p{L}\p{N}]
 * filter silently truncates the word to "আড". Latin accents are already folded
 * away by the step above, so nothing unwanted survives here.
 */
const NON_ALPHANUMERIC = /[^\p{L}\p{N}\p{M}]+/gu;

export function slugify(input: string): string {
  return (
    input
      // Decompose so "é" becomes "e" + accent, then drop the accent. Bengali
      // and other complex scripts pass through untouched because their marks
      // are outside the block above.
      .normalize("NFKD")
      .replace(LATIN_DIACRITICS, "")
      .toLowerCase()
      // "H&M" and "H and M" must collide, so the ampersand becomes a word
      // rather than a separator. Same for "+".
      .replace(/&/g, " and ")
      .replace(/\+/g, " plus ")
      .replace(NON_ALPHANUMERIC, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/** Display form: collapsed whitespace, trimmed. Case is left as the user typed it. */
export function normalizeDisplayName(input: string): string {
  return input.normalize("NFC").replace(/\s+/g, " ").trim();
}

export const MIN_SLUG_LENGTH = 1;
export const MAX_NAME_LENGTH = 80;

export type SlugValidation =
  | { ok: true; slug: string; name: string }
  | { ok: false; reason: "empty" | "too-long" | "no-alphanumeric" };

/**
 * Validates and normalises a proposed brand or tag name in one step, so a
 * caller cannot accidentally store a display name without its slug.
 */
export function prepareCatalogTerm(rawName: string): SlugValidation {
  const name = normalizeDisplayName(rawName);
  if (name.length === 0) return { ok: false, reason: "empty" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: "too-long" };

  const slug = slugify(name);
  // A name made entirely of emoji or punctuation produces an empty slug, which
  // would collide with every other such name on the unique index.
  if (slug.length < MIN_SLUG_LENGTH) {
    return { ok: false, reason: "no-alphanumeric" };
  }

  return { ok: true, slug, name };
}
