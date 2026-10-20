import { cookies } from "next/headers";
import { isTheme, THEME_COOKIE, type Theme } from "./theme";

/**
 * Resolves the theme on the server so the correct class is in the very first
 * byte of HTML. No flash, no inline script, and no hydration mismatch.
 *
 * Trade-off, stated plainly: reading a cookie in the root layout opts the app
 * into dynamic rendering. That is acceptable here because the storefront
 * header shows session and cart state on every page and was never going to be
 * statically renderable. The earlier alternative — an inline pre-paint script
 * — kept static rendering but tripped a React 19 warning about script tags in
 * the component tree and needed a mounted flag to avoid asserting the wrong
 * aria-checked during hydration.
 *
 * Revisit when Partial Prerendering is stable: a static shell with a dynamic
 * header would let us have both.
 */
export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : "system";
}
