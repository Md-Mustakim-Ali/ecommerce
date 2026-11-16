import { describe, expect, it } from "vitest";
import {
  adaptForDark,
  contrastRatio,
  DARK_BACKGROUND,
  LIGHT_BACKGROUND,
  luminance,
  MIN_CONTRAST,
} from "./color-picker";

/**
 * The contrast maths behind the picker's warning.
 *
 * Worth testing because the warning is the only thing standing between a
 * seller and a colour that reads perfectly on the swatch and disappears on the
 * page. A ratio computed wrongly would either cry wolf on every colour or stay
 * silent on the one case it exists for.
 */

describe("luminance", () => {
  it("anchors at black and white", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("weights green above red above blue, as human vision does", () => {
    const red = luminance("#ff0000");
    const green = luminance("#00ff00");
    const blue = luminance("#0000ff");
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it("ignores the leading hash either way", () => {
    expect(luminance("#7aa7f5")).toBeCloseTo(luminance("7aa7f5"), 10);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio("#1a56db", "#1a56db")).toBeCloseTo(1, 5);
  });

  it("does not care which way round the arguments come", () => {
    expect(contrastRatio("#1a56db", "#fbfaf9")).toBeCloseTo(
      contrastRatio("#fbfaf9", "#1a56db"),
      10,
    );
  });

  it("flags the exact failure the picker exists to prevent", () => {
    // A near-black chosen in the light editor: fine on white, invisible on the
    // dark page. The warning fires on the second one, not the first.
    const onLight = contrastRatio("#1a1a1a", "#fbfaf9");
    const onDark = contrastRatio("#1a1a1a", "#191817");
    expect(onLight).toBeGreaterThan(4.5);
    expect(onDark).toBeLessThan(4.5);
  });

  it("passes a colour that works on both", () => {
    // Roughly what the design tokens do: a mid blue for light, lifted for dark.
    expect(contrastRatio("#1a56db", "#fbfaf9")).toBeGreaterThan(4.5);
    expect(contrastRatio("#a8c7f8", "#191817")).toBeGreaterThan(4.5);
  });
});

describe("adaptForDark", () => {
  it("leaves a colour that already reads on dark completely alone", () => {
    // The picker must not override a decision it was not asked to make.
    for (const good of ["#a8c7f8", "#7dd3a0", "#f5a3a3", "#ffffff"]) {
      expect(adaptForDark(good), good).toBe(good);
    }
  });

  it("lifts a colour that would vanish against the dark page", () => {
    const adapted = adaptForDark("#1a1a1a");
    expect(adapted).not.toBe("#1a1a1a");
    expect(contrastRatio(adapted, DARK_BACKGROUND)).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    );
  });

  it("stops at the first value that clears the bar, staying near the original", () => {
    // A deep brand blue: readable on white, not on the dark page. The result
    // should be a lighter blue, not white.
    const adapted = adaptForDark("#1a56db");
    expect(contrastRatio(adapted, DARK_BACKGROUND)).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    );
    expect(adapted).not.toBe("#ffffff");
    // Still recognisably blue: the blue channel stays the largest.
    const [r, g, b] = [1, 3, 5].map((i) =>
      Number.parseInt(adapted.slice(i, i + 2), 16),
    );
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("always returns something readable, even from pure black", () => {
    expect(
      contrastRatio(adaptForDark("#000000"), DARK_BACKGROUND),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("passes malformed input straight through rather than guessing", () => {
    expect(adaptForDark("not-a-colour")).toBe("not-a-colour");
  });

  it("is idempotent — adapting twice changes nothing further", () => {
    const once = adaptForDark("#1a56db");
    expect(adaptForDark(once)).toBe(once);
  });
});

describe("the one-colour default", () => {
  it("means a sensible pick needs no second choice", () => {
    // What a seller actually does: pick a brand colour that reads on white,
    // and get a readable dark counterpart without being asked anything.
    const chosen = "#1a56db";
    expect(contrastRatio(chosen, LIGHT_BACKGROUND)).toBeGreaterThan(
      MIN_CONTRAST,
    );
    expect(
      contrastRatio(adaptForDark(chosen), DARK_BACKGROUND),
    ).toBeGreaterThan(MIN_CONTRAST);
  });
});
