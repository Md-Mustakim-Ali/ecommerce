/**
 * Splitting an amount of money across parts without losing or inventing a cent.
 *
 * This is the classic penny-allocation problem. Splitting 1000 three ways
 * gives 333.33… each; rounding each part independently gives 333 + 333 + 333
 * = 999 and one cent vanishes. Over a marketplace's order volume, vanished
 * cents are a reconciliation problem nobody can explain six months later.
 *
 * Largest-remainder: floor every share, then hand the leftover units out one
 * at a time to whichever parts were rounded down hardest. The result always
 * sums to exactly the input.
 */

export function allocateProportionally(
  totalCents: number,
  weights: readonly number[],
): number[] {
  if (weights.length === 0) return [];
  if (!Number.isInteger(totalCents)) {
    throw new Error(
      `allocateProportionally needs integer minor units, got ${totalCents}`,
    );
  }
  if (weights.some((w) => w < 0)) {
    throw new Error("Weights cannot be negative");
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Nothing to weigh by — split as evenly as possible instead of dividing by
  // zero. Happens when every line in an order is free.
  if (totalWeight === 0) return allocateEvenly(totalCents, weights.length);

  const exact = weights.map((w) => (totalCents * w) / totalWeight);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = totalCents - floors.reduce((sum, v) => sum + v, 0);

  // Rank by the size of the fraction that was discarded. Ties break on the
  // original index so the result is deterministic — the same cart must always
  // split the same way, or two runs disagree about a payout.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    result[order[cursor % order.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }
  // A negative total (a discount being spread) leaves a negative remainder.
  while (remainder < 0 && order.length > 0) {
    result[order[order.length - 1 - (cursor % order.length)].index] -= 1;
    remainder += 1;
    cursor += 1;
  }

  return result;
}

export function allocateEvenly(totalCents: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(totalCents / parts);
  let remainder = totalCents - base * parts;
  const result = Array.from({ length: parts }, () => base);

  const step = remainder >= 0 ? 1 : -1;
  let index = 0;
  while (remainder !== 0) {
    result[index % parts] += step;
    remainder -= step;
    index += 1;
  }
  return result;
}
