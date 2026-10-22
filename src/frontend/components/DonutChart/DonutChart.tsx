"use client";

import { useId, useState } from "react";
import { cx } from "@/frontend/lib/cx";
import { formatInr } from "@/frontend/lib/format";
import {
  arcPath,
  foldSlices,
  layoutSlices,
  percentLabel,
  type DonutItem,
} from "./geometry";
import styles from "./DonutChart.module.css";

type DonutChartProps = {
  /** Names the chart for screen readers and the data table. */
  label: string;
  items: DonutItem[];
  /** Defaults to rupees (values in paise). */
  formatValue?: (value: number) => string;
  /** Shown in the centre when nothing is hovered (defaults to the total). */
  centerLabel?: string;
  maxSlices?: number;
  onSelect?: (key: string) => void;
};

const SIZE = 200;
const RADIUS = 78;
const THICKNESS = 26;
/** Surface gap between slices, as an angle at the ring's centre line (~2px). */
const GAP = 2 / RADIUS;

/**
 * Donut with a centre readout. Hover, focus or tap a slice (or its legend row) to read its
 * amount and share; the legend always lists every slice with values, so identity never
 * depends on colour alone, and a hidden table carries the same data.
 */
export function DonutChart({
  label,
  items,
  formatValue = formatInr,
  centerLabel = "Total",
  maxSlices = 8,
  onSelect,
}: DonutChartProps) {
  const id = useId();
  const [active, setActive] = useState<string | null>(null);
  const slices = layoutSlices(foldSlices(items, maxSlices));
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const current = slices.find((s) => s.key === active);
  const c = SIZE / 2;

  if (slices.length === 0) return null;

  return (
    <div className={styles.container}>
      <div className={styles.wrap}>
        <div className={styles.figure}>
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className={styles.svg}
            role="img"
            aria-labelledby={`${id}-title`}
          >
            <title id={`${id}-title`}>{label}</title>
            <circle
              cx={c}
              cy={c}
              r={RADIUS}
              className={styles.track}
              strokeWidth={THICKNESS}
            />
            {slices.map((s) => {
              const gap = slices.length > 1 ? GAP / 2 : 0;
              const common = {
                className: cx(
                  styles.slice,
                  active && active !== s.key && styles.dimmed,
                ),
                stroke: s.color,
                strokeWidth: active === s.key ? THICKNESS + 6 : THICKNESS,
                onPointerEnter: () => setActive(s.key),
                onPointerLeave: () => setActive(null),
                onClick: () =>
                  onSelect
                    ? onSelect(s.key)
                    : setActive((a) => (a === s.key ? null : s.key)),
              };
              return s.share >= 0.9999 ? (
                <circle
                  key={s.key}
                  cx={c}
                  cy={c}
                  r={RADIUS}
                  fill="none"
                  {...common}
                />
              ) : (
                <path
                  key={s.key}
                  d={arcPath(c, c, RADIUS, s.start + gap, s.end - gap)}
                  fill="none"
                  {...common}
                />
              );
            })}
          </svg>
          <div className={styles.center} aria-live="polite">
            <span className={styles.centerLabel}>
              {current ? current.label : centerLabel}
            </span>
            <span className={cx(styles.centerValue, "tabular")}>
              {formatValue(current ? current.value : total)}
            </span>
            {current && (
              <span className={styles.centerShare}>
                {percentLabel(current.share)}
              </span>
            )}
          </div>
        </div>

        <ul className={styles.legend}>
          {slices.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className={cx(
                  styles.legendItem,
                  active === s.key && styles.legendActive,
                )}
                onPointerEnter={() => setActive(s.key)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(s.key)}
                onBlur={() => setActive(null)}
                onClick={() => onSelect?.(s.key)}
              >
                <span
                  className={styles.swatch}
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className={styles.legendLabel}>{s.label}</span>
                <span className={cx(styles.legendValue, "tabular")}>
                  {formatValue(s.value)}
                </span>
                <span className={cx(styles.legendShare, "tabular")}>
                  {percentLabel(s.share)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <table className="visually-hidden">
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Amount</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.key}>
                <th scope="row">{s.label}</th>
                <td>{formatValue(s.value)}</td>
                <td>{percentLabel(s.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
