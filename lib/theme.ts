export const THEME_COOKIE = "theme";
export const THEMES = ["light", "system", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** One year. A theme choice should outlive a browser restart. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" && (THEMES as readonly string[]).includes(value)
  );
}

/**
 * The class that goes on <html>.
 *
 * `system` deliberately produces no class: globals.css leaves
 * `color-scheme: light dark` on :root, so the OS preference already wins
 * without any class or any JavaScript.
 */
export function themeClass(theme: Theme): string {
  return theme === "system" ? "" : theme;
}

// Deliberately no server imports here. This module is pulled into the client
// bundle by the theme toggle; the cookie read lives in theme.server.ts.
