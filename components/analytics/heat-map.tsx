import type { HeatMatrix, IntentHeat, IntentStage } from "@/lib/analytics/heat";
import { SEQUENTIAL } from "./palette";

/**
 * A grid where colour carries magnitude.
 *
 * ── Why not recharts ─────────────────────────────────────────────────────
 *
 * Everything else on this page is a recharts chart, and this one is a table.
 * That is deliberate: a heat grid is rows, columns and a value per pair, which
 * is what a table element already is. Rendering it as a chart would cost the
 * semantics — a screen reader gets "rows of products by week" from a table and
 * gets an unlabelled SVG from the other — and buy nothing, because there is no
 * axis to scale and no path to draw.
 *
 * ── Colour is never the only channel ─────────────────────────────────────
 *
 * The number is printed in every non-empty cell. A sequential ramp encodes
 * magnitude well enough to find the hot corner at a glance and nowhere near
 * well enough to read a quantity off, and roughly one man in twelve cannot
 * separate the middle of a blue ramp reliably anyway. Colour finds it; the
 * number tells you what it is.
 *
 * Empty is drawn as empty rather than as the palest blue, so "no sales that
 * week" and "one sale that week" are not two shades of the same thing.
 */

/** Which band of the ramp a value falls in. Index 0 means nothing happened. */
function band(value: number, peak: number): number {
  if (value <= 0 || peak <= 0) return 0;
  // Six bands, matching the palette. Ceil so any non-zero value gets colour —
  // a real sale must never render as an empty cell.
  return Math.min(SEQUENTIAL.light.length, Math.ceil((value / peak) * 6));
}

function cellStyle(value: number, peak: number) {
  const index = band(value, peak);
  if (index === 0) return undefined;
  const light = SEQUENTIAL.light[index - 1];
  const dark = SEQUENTIAL.dark[index - 1];
  return {
    // Light and dark ramps differ, so the variable is set per cell and the
    // theme picks. Text flips to white on the darker half of the ramp, where
    // the project's own foreground would fall below contrast.
    "--heat": light,
    "--heat-dark": dark,
    color: index >= 4 ? "#ffffff" : undefined,
  } as React.CSSProperties;
}

const DIMENSION_NOUN: Record<HeatMatrix["dimension"], string> = {
  product: "Product",
  variant: "Variant",
  category: "Category",
  tag: "Tag",
};

export function DemandHeatMap({ matrix }: { matrix: HeatMatrix }) {
  if (matrix.rows.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed p-6 text-center text-secondary-text text-sm">
        Nothing sold in this window yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">
            Units sold per {DIMENSION_NOUN[matrix.dimension].toLowerCase()} per
            week. Darker means more.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface-1 px-2 py-1 text-left font-medium text-tertiary-text"
              >
                {DIMENSION_NOUN[matrix.dimension]}
              </th>
              {matrix.cols.map((col) => (
                <th
                  scope="col"
                  key={col}
                  className="px-1 py-1 text-center font-normal text-tertiary-text"
                  // The full date on hover; the column is too narrow for it.
                  title={col}
                >
                  {col.slice(8)}/{col.slice(5, 7)}
                </th>
              ))}
              <th
                scope="col"
                className="px-2 py-1 text-right font-medium text-tertiary-text"
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[14rem] truncate bg-surface-1 px-2 py-1 text-left font-normal"
                  title={row.label}
                >
                  {row.label}
                </th>
                {matrix.cols.map((col) => {
                  const value = matrix.cells[`${row.key}|${col}`] ?? 0;
                  return (
                    <td
                      key={col}
                      style={cellStyle(value, matrix.peak)}
                      className={`tabular rounded-sm px-1 py-1 text-center ${
                        value > 0
                          ? "bg-[var(--heat)] dark:bg-[var(--heat-dark)]"
                          : "bg-surface-2"
                      }`}
                      title={`${row.label} · week of ${col} · ${value} ${value === 1 ? "unit" : "units"}`}
                    >
                      {value > 0 ? value : ""}
                    </td>
                  );
                })}
                <td className="tabular px-2 py-1 text-right font-medium">
                  {row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Legend peak={matrix.peak} />
    </div>
  );
}

/**
 * Intent against purchase.
 *
 * Each column is scaled against its own maximum, and the caption says so —
 * without that the map reads as a lie, because baskets outnumber orders
 * several times over and every "ordered" cell would render nearly blank.
 */
const STAGES: { key: IntentStage; label: string; hint: string }[] = [
  { key: "saved", label: "Saved", hint: "On a wishlist now" },
  { key: "basketed", label: "Basketed", hint: "Put in a basket, ever" },
  { key: "ordered", label: "Ordered", hint: "Units actually bought" },
  { key: "returned", label: "Returned", hint: "Refund requests raised" },
];

export function IntentHeatMap({ heat }: { heat: IntentHeat }) {
  if (heat.rows.length === 0) {
    return (
      <p className="rounded-lg border border-border border-dashed p-6 text-center text-secondary-text text-sm">
        No interest recorded in this window yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">
            Interest and purchases per product. Each column is shaded against
            its own highest value, because the stages are not on one scale.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface-1 px-2 py-1 text-left font-medium text-tertiary-text"
              >
                Product
              </th>
              {STAGES.map((stage) => (
                <th
                  scope="col"
                  key={stage.key}
                  title={stage.hint}
                  className="px-2 py-1 text-center font-medium text-tertiary-text"
                >
                  {stage.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heat.rows.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[16rem] truncate bg-surface-1 px-2 py-1 text-left font-normal"
                  title={row.label}
                >
                  {row.label}
                </th>
                {STAGES.map((stage) => {
                  const value = row.counts[stage.key];
                  return (
                    <td
                      key={stage.key}
                      style={cellStyle(value, heat.peaks[stage.key])}
                      className={`tabular rounded-sm px-2 py-1 text-center ${
                        value > 0
                          ? "bg-[var(--heat)] dark:bg-[var(--heat-dark)]"
                          : "bg-surface-2"
                      }`}
                      title={`${row.label} · ${stage.label.toLowerCase()}: ${value}`}
                    >
                      {value > 0 ? value : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-tertiary-text text-xs">
        Each column is shaded against its own highest value — baskets always
        outnumber orders, so a shared scale would wash the others out. Read
        across a row: bright under Basketed and dark under Ordered is something
        people keep choosing and then not buying.
      </p>
    </div>
  );
}

function Legend({ peak }: { peak: number }) {
  return (
    <div className="flex items-center gap-2 text-tertiary-text text-xs">
      <span>0</span>
      <span className="flex gap-0.5">
        {SEQUENTIAL.light.map((light, index) => (
          <span
            key={light}
            aria-hidden
            style={
              {
                "--heat": light,
                "--heat-dark": SEQUENTIAL.dark[index],
              } as React.CSSProperties
            }
            className="size-3 rounded-sm bg-[var(--heat)] dark:bg-[var(--heat-dark)]"
          />
        ))}
      </span>
      <span>{peak} units in the busiest week</span>
    </div>
  );
}
