import { monthEndIst, monthStartIst, todayIst } from "./format";

export type PeriodKey = "this_month" | "last_month" | "last_3_months" | "this_year";

export const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "this_year", label: "This year" },
];

/** Inclusive IST date range for a preset. */
export function periodRange(key: PeriodKey): { from: string; to: string } {
  switch (key) {
    case "this_month":
      return { from: monthStartIst(0), to: todayIst() };
    case "last_month":
      return { from: monthStartIst(-1), to: monthEndIst(-1) };
    case "last_3_months":
      return { from: monthStartIst(-2), to: todayIst() };
    case "this_year":
      return { from: `${todayIst().slice(0, 4)}-01-01`, to: todayIst() };
  }
}
