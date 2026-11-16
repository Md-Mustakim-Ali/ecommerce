import { describe, expect, it } from "vitest";
import {
  EMPTY_DOC,
  extractMediaIds,
  FONT_CATALOGUE,
  FONT_FAMILY_VARS,
  flattenToText,
  HIGHLIGHT_VARS,
  highlightValue,
  isEmptyDoc,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseDescriptionDoc,
  TEXT_COLOR_VARS,
  TEXT_COLORS,
  textColorValue,
} from "./schema";

const ID_A = "0193c3e0-0000-7000-8000-000000000001";
const ID_B = "0193c3e0-0000-7000-8000-000000000002";

const text = (value: string) => ({ type: "text" as const, text: value });
const para = (value: string) => ({
  type: "paragraph" as const,
  content: [text(value)],
});
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("parseDescriptionDoc — accepts", () => {
  it("an empty document", () => {
    expect(parseDescriptionDoc(EMPTY_DOC).ok).toBe(true);
  });

  it("paragraphs, headings, lists and rules", () => {
    const result = parseDescriptionDoc(
      doc(
        para("Woven in Rajshahi."),
        { type: "heading", attrs: { level: 2 }, content: [text("Care")] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [para("Cold wash")] },
            { type: "listItem", content: [para("Line dry")] },
          ],
        },
        { type: "horizontalRule" },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("a media embed", () => {
    const result = parseDescriptionDoc(
      doc({ type: "media", attrs: { mediaId: ID_A, caption: "On the loom" } }),
    );
    expect(result.ok).toBe(true);
  });

  it("every semantic colour", () => {
    for (const color of TEXT_COLORS) {
      const result = parseDescriptionDoc(
        doc({
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "textColor", attrs: { color } }],
            },
          ],
        }),
      );
      expect(result.ok).toBe(true);
    }
  });
});

describe("parseDescriptionDoc — rejects", () => {
  it("a javascript: link", () => {
    // The one place a document carries a URL is the one place an injection
    // can enter.
    const result = parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("a data: link", () => {
    const result = parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click",
            marks: [
              { type: "link", attrs: { href: "data:text/html,<script>" } },
            ],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("a raw hex colour", () => {
    // Storing hex is the bug: it looks right in the light editor and is
    // unreadable in dark mode, and the seller never sees it happen.
    const result = parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "x",
            marks: [{ type: "textColor", attrs: { color: "#1a1a1a" } }],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("an h1, which would compete with the product title", () => {
    const result = parseDescriptionDoc(
      doc({ type: "heading", attrs: { level: 1 }, content: [text("Title")] }),
    );
    expect(result.ok).toBe(false);
  });

  it("an unknown node type", () => {
    const result = parseDescriptionDoc(
      doc({ type: "script", content: [text("alert(1)")] }),
    );
    expect(result.ok).toBe(false);
  });

  it("an embed whose id is not a uuid", () => {
    const result = parseDescriptionDoc(
      doc({ type: "media", attrs: { mediaId: "../../etc/passwd" } }),
    );
    expect(result.ok).toBe(false);
  });

  it("something that is not a document at all", () => {
    expect(parseDescriptionDoc(null).ok).toBe(false);
    expect(parseDescriptionDoc("<p>hi</p>").ok).toBe(false);
    expect(parseDescriptionDoc({ type: "paragraph" }).ok).toBe(false);
  });

  it("a pathologically nested paste", () => {
    let node: unknown = para("bottom");
    for (let i = 0; i < 40; i++) {
      node = { type: "blockquote", content: [node] };
    }
    const result = parseDescriptionDoc(doc(node));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nested too deeply/);
  });
});

describe("custom text colours", () => {
  const colored = (attrs: unknown) =>
    parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "x", marks: [{ type: "textColor", attrs }] },
        ],
      }),
    );

  it("accepts a light/dark pair", () => {
    expect(colored({ light: "#1a56db", dark: "#7aa7f5" }).ok).toBe(true);
  });

  it("accepts uppercase hex", () => {
    expect(colored({ light: "#1A56DB", dark: "#7AA7F5" }).ok).toBe(true);
  });

  it("refuses a light colour with no dark counterpart", () => {
    // The entire reason the pair is required. One hex chosen in the light
    // editor is applied in dark mode too, and the seller never sees it.
    expect(colored({ light: "#1a56db" }).ok).toBe(false);
    expect(colored({ dark: "#7aa7f5" }).ok).toBe(false);
  });

  it("refuses a token and a pair at once", () => {
    // No defined meaning — the renderer would have to pick one silently.
    expect(
      colored({ color: "positive", light: "#1a56db", dark: "#7aa7f5" }).ok,
    ).toBe(false);
  });

  it("refuses a mark that colours nothing", () => {
    expect(colored({}).ok).toBe(false);
    expect(colored({ color: null, light: null, dark: null }).ok).toBe(false);
  });

  it("refuses anything that is not a 6-digit hex", () => {
    // These land in a style attribute, where CSS accepts far more than
    // colours. url() is the payload that matters.
    for (const bad of [
      "#fff",
      "red",
      "rgb(255,0,0)",
      "url(https://evil.test/x.png)",
      "#1a56db; background: url(x)",
      "javascript:alert(1)",
    ]) {
      expect(colored({ light: bad, dark: "#7aa7f5" }).ok, bad).toBe(false);
    }
  });
});

describe("textColorValue", () => {
  it("resolves a token to its CSS variable", () => {
    expect(textColorValue({ color: "positive" })).toBe("var(--color-positive)");
  });

  it("resolves a pair to light-dark(), the same mechanism the tokens use", () => {
    expect(textColorValue({ light: "#1a56db", dark: "#7aa7f5" })).toBe(
      "light-dark(#1a56db, #7aa7f5)",
    );
  });

  it("prefers the pair when somehow given both", () => {
    // Defensive: the schema rejects this, but the renderer must still be
    // deterministic if a row predates that rule.
    expect(
      textColorValue({ color: "positive", light: "#111111", dark: "#eeeeee" }),
    ).toBe("light-dark(#111111, #eeeeee)");
  });

  it("returns null rather than an empty style", () => {
    expect(textColorValue({})).toBeNull();
    expect(textColorValue({ light: "#1a56db" })).toBeNull();
  });
});

describe("highlights", () => {
  const marked = (attrs: unknown) =>
    parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "x", marks: [{ type: "highlight", attrs }] },
        ],
      }),
    );

  it("accepts a named colour", () => {
    expect(marked({ color: "positive" }).ok).toBe(true);
  });

  it("accepts a custom light/dark pair", () => {
    expect(marked({ light: "#fff3cd", dark: "#4a3b12" }).ok).toBe(true);
  });

  it("refuses a lone hex, exactly as text colour does", () => {
    expect(marked({ light: "#fff3cd" }).ok).toBe(false);
  });

  it("refuses a token and a pair together", () => {
    expect(
      marked({ color: "positive", light: "#fff3cd", dark: "#4a3b12" }).ok,
    ).toBe(false);
  });

  it("resolves both forms", () => {
    expect(highlightValue({ color: "critical" })).toBe(
      "var(--color-critical-muted)",
    );
    expect(highlightValue({ light: "#fff3cd", dark: "#4a3b12" })).toBe(
      "light-dark(#fff3cd, #4a3b12)",
    );
    expect(highlightValue({})).toBeNull();
  });
});

describe("font family", () => {
  const withFont = (family: unknown) =>
    parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "x",
            marks: [{ type: "fontFamily", attrs: { family } }],
          },
        ],
      }),
    );

  it("accepts every family in the catalogue", () => {
    for (const font of FONT_CATALOGUE) {
      expect(withFont(font.id).ok, font.id).toBe(true);
    }
  });

  it("refuses a font that is not in the catalogue", () => {
    // The whole point of a closed list: a name typed by hand would either load
    // an arbitrary web font for every buyer or silently fall back.
    for (const bad of ["Comic Sans MS", "Arial", "", "../../etc/passwd"]) {
      expect(withFont(bad).ok, bad).toBe(false);
    }
  });

  it("gives every catalogue entry a stack and a unique id", () => {
    const ids = FONT_CATALOGUE.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const font of FONT_CATALOGUE) {
      expect(FONT_FAMILY_VARS[font.id], font.id).toBeTruthy();
      expect(font.label.length).toBeGreaterThan(0);
      expect(font.category.length).toBeGreaterThan(0);
    }
  });
});

describe("font size", () => {
  const withSize = (size: unknown) =>
    parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "x",
            marks: [{ type: "fontSize", attrs: { size } }],
          },
        ],
      }),
    );

  it("accepts sizes inside the range", () => {
    for (const size of [MIN_FONT_SIZE, 14, 24, MAX_FONT_SIZE]) {
      expect(withSize(size).ok, String(size)).toBe(true);
    }
  });

  it("refuses sizes outside it", () => {
    // Below 10 is unreadable on a phone; above 72 overflows the column, and
    // neither is visible to the seller at the width a buyer sees.
    for (const size of [MIN_FONT_SIZE - 1, MAX_FONT_SIZE + 1, 0, -12, 1000]) {
      expect(withSize(size).ok, String(size)).toBe(false);
    }
  });

  it("refuses anything that is not a whole number", () => {
    for (const size of [14.5, "16", "16px", null, Number.NaN]) {
      expect(withSize(size).ok, String(size)).toBe(false);
    }
  });
});

describe("extractMediaIds", () => {
  it("finds embeds at the top level", () => {
    const parsed = parseDescriptionDoc(
      doc(
        para("Before"),
        { type: "media", attrs: { mediaId: ID_A } },
        { type: "media", attrs: { mediaId: ID_B } },
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(extractMediaIds(parsed.doc)).toEqual([ID_A, ID_B]);
  });

  it("finds embeds nested in lists and quotes", () => {
    // The gate has to see these too, or a video inside a bullet point
    // publishes while still transcoding.
    const parsed = parseDescriptionDoc(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "blockquote",
                content: [{ type: "media", attrs: { mediaId: ID_A } }],
              },
            ],
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(extractMediaIds(parsed.doc)).toEqual([ID_A]);
  });

  it("deduplicates the same asset used twice", () => {
    const parsed = parseDescriptionDoc(
      doc({ type: "media", attrs: { mediaId: ID_A } }, para("and again"), {
        type: "media",
        attrs: { mediaId: ID_A },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(extractMediaIds(parsed.doc)).toEqual([ID_A]);
  });

  it("returns nothing for a document with no media", () => {
    expect(extractMediaIds(EMPTY_DOC)).toEqual([]);
  });
});

describe("flattenToText", () => {
  it("keeps the words search needs", () => {
    // products.search_vector is generated over products.description, and a
    // generated column cannot reach into jsonb. Without this mirror, rich
    // descriptions vanish from search.
    const parsed = parseDescriptionDoc(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Fabric")] },
        para("Handloom cotton from Rajshahi."),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para("Cold wash only")] }],
        },
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const flat = flattenToText(parsed.doc);
    expect(flat).toContain("Fabric");
    expect(flat).toContain("Handloom cotton from Rajshahi.");
    expect(flat).toContain("Cold wash only");
  });

  it("includes captions but not markup", () => {
    const parsed = parseDescriptionDoc(
      doc({
        type: "media",
        attrs: { mediaId: ID_A, caption: "Weaving in progress" },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(flattenToText(parsed.doc)).toBe("Weaving in progress");
  });

  it("preserves text that carries marks", () => {
    const parsed = parseDescriptionDoc(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "Limited ", marks: [{ type: "bold" }] },
          { type: "text", text: "edition" },
        ],
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(flattenToText(parsed.doc)).toBe("Limited edition");
  });

  it("is empty for an empty document", () => {
    expect(flattenToText(EMPTY_DOC)).toBe("");
  });
});

describe("isEmptyDoc", () => {
  it("treats an untouched editor as empty", () => {
    const parsed = parseDescriptionDoc(doc({ type: "paragraph" }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(isEmptyDoc(parsed.doc)).toBe(true);
  });

  it("does not treat a media-only description as empty", () => {
    // A product whose description is one video still has a description.
    const parsed = parseDescriptionDoc(
      doc({ type: "media", attrs: { mediaId: ID_A } }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(isEmptyDoc(parsed.doc)).toBe(false);
  });
});

describe("colour tokens", () => {
  it("maps every colour to a CSS variable, never a literal", () => {
    // A hex value here would be a light-mode-only colour smuggled back in.
    for (const value of Object.values(TEXT_COLOR_VARS)) {
      expect(value).toMatch(/^var\(--color-/);
    }
    for (const value of Object.values(HIGHLIGHT_VARS)) {
      expect(value).toMatch(/^var\(--color-/);
    }
  });
});
