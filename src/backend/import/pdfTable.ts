import "server-only";
import { STATEMENT_TABLE } from "@/backend/constants/app.constants";
import { headerSignature, isAmountLike, isDateLike, looksLikeHeaderRow } from "./text";
import type { TableRead } from "./types";

/** A piece of text on a PDF page: its position (PDF units, y grows upwards) and width. */
export type PdfItem = { str: string; x: number; y: number; w: number };

type Cell = { text: string; x0: number; x1: number };
type Line = { y: number; cells: Cell[] };
type Column = { name: string; x0: number; x1: number };
/** A transaction being assembled: text per column from each of its lines, kept with the line's y. */
type Record = { y: number; parts: Array<{ y: number; texts: string[][] }>; time: string[]; hasAmount: boolean };

/** A record's cells, each joined from its lines top to bottom (reading order). */
const cellsOf = (r: Record, width: number) =>
  Array.from({ length: width }, (_, i) =>
    [...r.parts]
      .sort((a, b) => b.y - a.y)
      .flatMap((p) => p.texts[i] ?? [])
      .join(" "),
  );

/** Items whose baselines differ by less than this are on the same visual line. */
const LINE_TOLERANCE = 2.5;
/** Items closer than this horizontally are one cell ("Withdrawal" + "Amt."). */
const CELL_GAP = 4;
/** A second header line ("(Dr.)", "INR") sits at most this far under the first. */
const HEADER_FOLLOW_GAP = 14;
/** A line further than this many typical line gaps from every record is a footer, total or note. */
const ATTACH_GAPS = 2.5;
/** Lines closer than this many in-row gaps are one block (one row of the table). */
const BLOCK_GAP_FACTOR = 1.2;
const TIME_ONLY = /^\d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?$/i;
const DATE_COLUMN = /date/i;
const AMOUNT_COLUMN = /debit|credit|withdraw|deposit|amount|balance|\bdr\b|\bcr\b/i;

/** Rebuilds visual lines (top to bottom) and their cells (left to right) from positioned items. */
export function toLines(items: readonly PdfItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PdfItem[][] = [];
  for (const item of sorted) {
    const current = groups.at(-1);
    if (current && Math.abs(current[0].y - item.y) <= LINE_TOLERANCE) current.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const cells: Cell[] = [];
    for (const item of group.sort((a, b) => a.x - b.x)) {
      const last = cells.at(-1);
      const text = item.str.trim();
      if (last && item.x - last.x1 < CELL_GAP) {
        last.text = `${last.text} ${text}`;
        last.x1 = Math.max(last.x1, item.x + item.w);
      } else cells.push({ text, x0: item.x, x1: item.x + item.w });
    }
    return { y: group[0].y, cells };
  });
}

export const lineText = (line: Line) => line.cells.map((c) => c.text).join(" ");

/**
 * The column a cell belongs to: the header cell it overlaps most. A cell under no header is
 * either an amount (nearest column) or text running on from a left-aligned column (the nearest
 * column starting to its left), so stray description words never land in an amount column.
 */
function columnFor(cell: Cell, columns: readonly Column[]): number {
  let best = -1;
  let bestOverlap = 0;
  let nearest = 0;
  let nearestGap = Number.POSITIVE_INFINITY;
  let left = -1;
  columns.forEach((c, i) => {
    const overlap = Math.min(cell.x1, c.x1) - Math.max(cell.x0, c.x0);
    if (overlap > bestOverlap) [best, bestOverlap] = [i, overlap];
    const gap = Math.max(c.x0 - cell.x1, cell.x0 - c.x1, 0);
    if (gap < nearestGap) [nearest, nearestGap] = [i, gap];
    if (c.x0 <= cell.x0 && (left < 0 || c.x0 > columns[left].x0)) left = i;
  });
  if (best >= 0) return best;
  return isAmountLike(cell.text) || left < 0 ? nearest : left;
}

/**
 * Column extents as the data actually uses them: headers are often centred over their column, so a
 * description column starts well left of its header. Text cells that overlap exactly one header
 * widen that column (never into a neighbour), so short cells in the same column are placed right.
 */
function widenColumns(columns: readonly Column[], lines: readonly Line[]): Column[] {
  const wide = columns.map((c) => ({ ...c }));
  for (const line of lines) {
    for (const cell of line.cells) {
      if (isAmountLike(cell.text) || isDateLike(cell.text)) continue;
      const hits = columns.flatMap((c, i) => (Math.min(cell.x1, c.x1) - Math.max(cell.x0, c.x0) > 0 ? [i] : []));
      if (hits.length !== 1) continue;
      const i = hits[0];
      const leftLimit = i > 0 ? columns[i - 1].x1 : Number.NEGATIVE_INFINITY;
      const rightLimit = i < columns.length - 1 ? columns[i + 1].x0 : Number.POSITIVE_INFINITY;
      wide[i].x0 = Math.max(Math.min(wide[i].x0, cell.x0), leftLimit);
      wide[i].x1 = Math.min(Math.max(wide[i].x1, cell.x1), rightLimit);
    }
  }
  return wide;
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Rows are usually spaced further apart than the lines inside a row (Axis: 9pt within, 13pt
 * between). Lines closer than the in-row gap form a block; a block holding exactly one date line is
 * that record, wherever the date sits in it (first, middle or last line). Lines in blocks with no
 * date line or several (evenly spaced layouts) get no answer here and fall back to nearest-record.
 */
function recordsByBlock(placed: ReadonlyArray<{ isAnchor: boolean }>, gaps: readonly number[], recordAt: ReadonlyMap<number, Record>): Array<Record | undefined> {
  const out: Array<Record | undefined> = placed.map(() => undefined);
  if (gaps.length < 2) return out;
  const sorted = [...gaps].sort((a, b) => a - b);
  const inRow = sorted[Math.floor(sorted.length / 4)];
  const limit = inRow * BLOCK_GAP_FACTOR;
  // Only meaningful when rows really are spaced wider than their lines.
  if (!sorted.some((g) => g > limit)) return out;
  let start = 0;
  for (let i = 1; i <= placed.length; i++) {
    if (i < placed.length && gaps[i - 1] <= limit) continue;
    const members = Array.from({ length: i - start }, (_, k) => start + k);
    const dated = members.filter((m) => placed[m].isAnchor);
    if (dated.length === 1) for (const m of members) out[m] = recordAt.get(dated[0]);
    start = i;
  }
  return out;
}

/** Header cells of `line` (plus a second header line just below it, merged by column). */
function readHeader(lines: readonly Line[], index: number): { columns: Column[]; consumed: number } {
  const columns = lines[index].cells.map((c) => ({ name: c.text, x0: c.x0, x1: c.x1 }));
  const next = lines[index + 1];
  const continues =
    next &&
    lines[index].y - next.y <= HEADER_FOLLOW_GAP &&
    next.cells.every((c) => c.text.length <= 14 && !isDateLike(c.text) && !isAmountLike(c.text));
  if (continues) {
    for (const cell of next.cells) {
      const col = columns[columnFor(cell, columns)];
      col.name = `${col.name} ${cell.text}`;
    }
  }
  return { columns, consumed: continues ? 2 : 1 };
}

/**
 * Turns a text PDF's pages into a table: the header (on page 1 or wherever the table starts) gives
 * the columns, values are placed under the header cell they overlap, and the lines of a multi-line
 * record (description above or below the date, time underneath, amounts on a later line) are
 * joined into one row. A different header later starts a new section (its header row is emitted
 * again, for splitSections); a repeated header only refreshes column positions for its page.
 * Returns null when the PDF isn't laid out as a table (e.g. UPI app "Paid to …" statements).
 */
export function buildPdfTable(pages: readonly PdfItem[][]): TableRead | null {
  // Header rows and records in reading order; records stay open until the end, because a record
  // cut by a page break continues at the top of the next page.
  const out: Array<string[] | Record> = [];
  let carry: Record | undefined;
  let columns: Column[] | null = null;
  let signature = "";
  let records = 0;

  for (const items of pages) {
    const lines = toLines(items);
    let start = 0;
    // The page's header: of the lines that look like one, the one with the most columns.
    const headerAt = lines.reduce((best, l, i) => (looksLikeHeaderRow(l.cells.map((c) => c.text)) && (best < 0 || l.cells.length > lines[best].cells.length) ? i : best), -1);
    if (headerAt >= 0) {
      const { columns: found, consumed } = readHeader(lines, headerAt);
      const foundSignature = headerSignature(found.map((c) => c.name));
      if (foundSignature !== signature) {
        out.push(found.map((c) => c.name));
        carry = undefined;
      }
      [columns, signature] = [found, foundSignature];
      start = headerAt + consumed;
    }
    if (!columns) continue;
    columns = widenColumns(columns, lines.slice(start));
    const cols = columns;
    const dateColumn = cols.findIndex((c) => DATE_COLUMN.test(c.name));
    if (dateColumn < 0) return null;
    const amountColumns = new Set(cols.flatMap((c, i) => (AMOUNT_COLUMN.test(c.name) ? [i] : [])));

    // Place every cell of every line under its column.
    const placed = lines.slice(start).map((line) => {
      const byColumn: string[][] = cols.map(() => []);
      for (const cell of line.cells) byColumn[columnFor(cell, cols)].push(cell.text);
      const date = byColumn[dateColumn].join(" ");
      const hasAmount = [...amountColumns].some((i) => byColumn[i].some((t) => isAmountLike(t)));
      return { y: line.y, byColumn, isAnchor: isDateLike(date) && !TIME_ONLY.test(date), hasAmount };
    });

    const recordAt = new Map<number, Record>();
    placed.forEach((p, i) => {
      if (p.isAnchor) recordAt.set(i, { y: p.y, parts: [{ y: p.y, texts: p.byColumn }], time: [], hasAmount: p.hasAmount });
    });
    const anchors = [...recordAt.values()];
    if (anchors.length === 0) continue;
    const gaps = placed.slice(1).map((p, i) => placed[i].y - p.y);
    const maxDistance = Math.max(median(gaps), 6) * ATTACH_GAPS;
    const blockRecord = recordsByBlock(placed, gaps, recordAt);

    let anchorIdx = 0;
    for (const [index, p] of placed.entries()) {
      if (p.isAnchor) {
        anchorIdx += 1;
        continue;
      }
      // Before the page's first record, "above" is the last record of the previous page.
      const prev = anchorIdx > 0 ? anchors[anchorIdx - 1] : carry;
      const next = anchors[anchorIdx];
      const distPrev = anchorIdx > 0 && prev ? prev.y - p.y : prev ? 0 : Number.POSITIVE_INFINITY;
      const distNext = next ? p.y - next.y : Number.POSITIVE_INFINITY;
      // Spacing says which row the line belongs to; otherwise the nearest record takes it.
      let target: Record | undefined = blockRecord[index];
      if (!target && p.hasAmount) {
        // A record's amounts never come before its date line: fill the record above first.
        if (prev && !prev.hasAmount && distPrev <= maxDistance * 2) target = prev;
        else if (next && !next.hasAmount && distNext <= maxDistance) target = next;
      } else if (!target && (distPrev <= maxDistance || distNext <= maxDistance)) {
        // Text joins the nearer record (description above or below the date line).
        target = distPrev <= distNext ? prev : next;
      }
      if (!target) continue;
      // A time under the date goes to its own column; everything else joins its column.
      target.time.push(...p.byColumn[dateColumn].filter((t) => TIME_ONLY.test(t)));
      target.parts.push({ y: p.y, texts: p.byColumn.map((texts, i) => (i === dateColumn ? texts.filter((t) => !TIME_ONLY.test(t)) : texts)) });
      target.hasAmount ||= p.hasAmount;
    }

    out.push(...anchors);
    carry = anchors.at(-1);
    records += anchors.length;
  }

  if (records < STATEMENT_TABLE.MIN_PDF_RECORDS) return null;
  // The synthetic Time column exists only when some record had a time line under its date.
  const usesTime = out.some((r) => !Array.isArray(r) && r.time.length > 0);
  let width = 0;
  const rows = out.map((r) => {
    if (Array.isArray(r)) {
      width = r.length;
      return usesTime ? [...r, "Time"] : r;
    }
    const cells = cellsOf(r, width);
    return usesTime ? [...cells, r.time.join(" ")] : cells;
  });
  return { kind: "table", rows };
}
