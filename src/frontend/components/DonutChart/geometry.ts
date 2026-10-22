/** Pure geometry for DonutChart (kept apart from React so it can be unit-tested). */

export type DonutItem = { key: string; label: string; value: number; color?: string | null };
export type DonutSlice = DonutItem & { color: string; share: number; start: number; end: number };

export const OTHER_KEY = "__other";

/** Categorical slots from tokens.css, in their validated fixed order. */
export const CHART_SLOTS = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);

/**
 * Largest first, non-positive values dropped; beyond `maxSlices` the tail folds into one
 * "Other" slice (a 9th colour is never generated).
 */
export function foldSlices(items: readonly DonutItem[], maxSlices: number, otherLabel = "Other"): DonutItem[] {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= maxSlices) return sorted;
  const kept = sorted.slice(0, maxSlices - 1);
  const rest = sorted.slice(maxSlices - 1).reduce((sum, i) => sum + i.value, 0);
  return [...kept, { key: OTHER_KEY, label: otherLabel, value: rest, color: "var(--chart-other)" }];
}

/** Angles in radians, clockwise from 12 o'clock; colours from the item or the fixed slot order. */
export function layoutSlices(items: readonly DonutItem[]): DonutSlice[] {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (total <= 0) return [];
  let angle = -Math.PI / 2;
  return items.map((item, index) => {
    const share = item.value / total;
    const start = angle;
    angle += share * Math.PI * 2;
    return { ...item, color: item.color ?? CHART_SLOTS[index % CHART_SLOTS.length], share, start, end: angle };
  });
}

const point = (cx: number, cy: number, r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;

/** SVG path along the ring's centre line from `start` to `end` (stroked to form the slice). */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${point(cx, cy, r, start)} A ${r} ${r} 0 ${large} 1 ${point(cx, cy, r, end)}`;
}

/** Whole-number percentage for labels ("<1%" for tiny non-zero shares). */
export const percentLabel = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
