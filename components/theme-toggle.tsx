"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useState } from "react";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEMES,
  type Theme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  system: Monitor,
  dark: Moon,
};

const LABELS: Record<Theme, string> = {
  light: "Light",
  system: "System",
  dark: "Dark",
};

/**
 * Three-way theme control.
 *
 * Built on real radio inputs inside a fieldset rather than buttons with
 * role="radio". Native radios bring roving focus and arrow-key navigation for
 * free; the ARIA pattern would mean reimplementing both by hand, and any hand
 * rolled version is one bug away from being unusable with a keyboard.
 *
 * `value` is resolved on the server from the cookie, so the correct option is
 * checked in the first render — no mounted flag and no hydration mismatch.
 * The class is written straight to <html> so the switch is instant; the cookie
 * only makes it survive a reload.
 */
export function ThemeToggle({
  value,
  className,
}: {
  value: Theme;
  className?: string;
}) {
  const [theme, setTheme] = useState<Theme>(value);
  const name = useId();

  function commit(next: Theme) {
    // biome-ignore lint/suspicious/noDocumentCookie: CookieStore is unsupported in Safari; this must work everywhere.
    document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (next !== "system") root.classList.add(next);
    setTheme(next);
  }

  function apply(next: Theme, origin: HTMLElement) {
    if (next === theme) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Progressive enhancement: without View Transitions, or under reduced
    // motion, the theme still switches — just instantly.
    if (reduced || !document.startViewTransition) {
      commit(next);
      return;
    }

    // The reveal starts at the control that changed, so the switch reads as
    // caused by the interaction rather than as an unexplained wipe.
    const rect = origin.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    // Marks this transition as the theme's, so the CSS that suppresses the
    // root cross-fade applies here and not to a page navigation — which needs
    // the cross-fade, and would otherwise cut hard between two pages.
    document.documentElement.dataset.themeTransition = "";

    const transition = document.startViewTransition(() => commit(next));
    transition.finished.finally(() => {
      delete document.documentElement.dataset.themeTransition;
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 420,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      // `ready` rejects whenever the transition is skipped — a rapid second
      // change, a backgrounded tab. Expected, and the theme is already applied.
      .catch(() => {});
  }

  return (
    <fieldset
      className={cn(
        "inline-flex items-center gap-0.5 rounded-control border border-border bg-surface-sunken p-0.5",
        className,
      )}
    >
      <legend className="sr-only">Colour theme</legend>

      {THEMES.map((option) => {
        const Icon = ICONS[option];
        const selected = theme === option;

        return (
          <label
            key={option}
            title={LABELS[option]}
            className={cn(
              "grid size-8 cursor-pointer place-items-center rounded-full",
              "transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-out)",
              "touch-manipulation active:scale-[0.92]",
              "has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-ring has-focus-visible:outline-offset-2",
              selected
                ? "bg-surface-1 text-primary-text shadow-e1"
                : "text-tertiary-text hover:text-secondary-text",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={selected}
              onChange={(event) => apply(option, event.currentTarget)}
              className="sr-only"
            />
            <Icon className="size-4" aria-hidden />
            <span className="sr-only">{LABELS[option]}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
