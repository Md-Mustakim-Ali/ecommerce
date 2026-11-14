import { describe, expect, it } from "vitest";
import {
  EMPTY_DOC,
  extractMediaIds,
  flattenToText,
  HIGHLIGHT_VARS,
  isEmptyDoc,
  parseDescriptionDoc,
  TEXT_COLOR_VARS,
  TEXT_COLORS,
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
