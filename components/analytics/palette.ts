/**
 * The chart palette.
 *
 * Validated with the data-viz validator against this project's own chart
 * surfaces (#fcfdff light, #191e25 dark) rather than the reference ones,
 * because contrast and lightness-band results are only meaningful against the
 * surface a chart actually renders on. Both modes pass every gate:
 *
 *   light  CVD ΔE 9.1 (yellow↔aqua, protan) · normal-vision ΔE 19.6
 *   dark   CVD ΔE 8.4 (yellow↔aqua, protan) · normal-vision ΔE 19.3
 *
 * Light mode carries a contrast WARN on aqua, yellow and magenta — all three
 * sit below 3:1 on a near-white surface. That obligates relief, so every chart
 * using slots past the second ships direct labels or a table view beside it.
 * It is not dismissable.
 *
 * The slot ORDER is the colourblind-safety mechanism, not decoration. Assign
 * hues in this fixed order and never cycle: a ninth series folds into "Other"
 * rather than reusing slot 1, and a filter that removes a series must not
 * repaint the survivors.
 */

export const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
} as const;

/** Single hue, light to dark. For continuous magnitude only. */
export const SEQUENTIAL = {
  light: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"],
  dark: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"],
} as const;

/**
 * Reserved, never used for a series.
 *
 * These ship with an icon and a label everywhere they appear — on the light
 * surface warning and serious are deliberately sub-3:1, so colour never
 * carries the meaning by itself.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/** Chart chrome, matched to the app's own surfaces. */
export const CHROME = {
  light: {
    surface: "#fcfdff",
    grid: "#e4e6ec",
    axis: "#c2c6d0",
    muted: "#7c828f",
  },
  dark: {
    surface: "#191e25",
    grid: "#2c323b",
    axis: "#3a414c",
    muted: "#8b919c",
  },
} as const;

/**
 * A ChartConfig entry for one series, carrying both modes.
 *
 * shadcn's ChartStyle emits the light value and a `.dark` override from this,
 * so dark mode is a selected step from the same ramp rather than an automatic
 * flip of the light one.
 */
export function series(index: number, label: string) {
  const slot = index % SERIES.light.length;
  return {
    label,
    theme: { light: SERIES.light[slot], dark: SERIES.dark[slot] },
  };
}
