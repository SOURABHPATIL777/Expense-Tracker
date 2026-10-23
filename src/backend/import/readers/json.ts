import "server-only";
import { AppError } from "@/backend/errors/AppError";
import type { TextRead } from "@/backend/import/types";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const MAX_DEPTH = 60;
const FLATTEN_DEPTH = 30;
const MAX_COLUMNS = 40;
const MAX_LINE = 400;

const isObject = (v: Json): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The largest array of objects anywhere in the document (the list of transactions). */
function largestRecordList(value: Json, depth = 0): Obj[] {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return [];
  let best: Obj[] = Array.isArray(value) ? value.filter(isObject) : [];
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = largestRecordList(child, depth + 1);
    if (found.length > best.length) best = found;
  }
  return best;
}

/** `{ a: { b: 1 }, c: [x, y] }` → `{ "a.b": "1", c: "x; y" }`. */
function flatten(value: Json, prefix = "", depth = 0, out: Record<string, string> = {}): Record<string, string> {
  if (isObject(value) && depth < FLATTEN_DEPTH) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  } else if (Array.isArray(value)) {
    // Lists become one cell: values of nested objects joined ("details: [{name: "UPI"}]" → "UPI").
    out[prefix] = value.map((v) => (isObject(v) || Array.isArray(v) ? Object.values(flatten(v, "", depth + 1)).join(" ") : String(v ?? ""))).join("; ");
  } else if (value !== null && value !== undefined) {
    out[prefix] = isObject(value) ? JSON.stringify(value) : String(value);
  }
  return out;
}

/**
 * JSON exports (Google Takeout "My Activity.json", bank/app API dumps): the records become a table
 * (keys as columns) to try first, and text lines ("key: value; …") for the AI reader otherwise.
 */
export function readJson(buffer: Buffer): TextRead {
  let doc: Json;
  try {
    doc = JSON.parse(buffer.toString("utf8").replace(/^﻿/, "")) as Json;
  } catch (err) {
    throw new AppError("IMPORT_UNREADABLE", { message: "This JSON file couldn't be read. Upload the file exactly as exported.", cause: err });
  }
  const records = largestRecordList(doc).map((r) => flatten(r));
  const columns = [...new Set(records.flatMap((r) => Object.keys(r)))].slice(0, MAX_COLUMNS);
  const lines = records.map((r) =>
    columns
      .filter((c) => r[c])
      .map((c) => `${c}: ${r[c]}`)
      .join("; ")
      .slice(0, MAX_LINE),
  );
  if (!records.length) return { kind: "text", lines: [] };
  return { kind: "text", lines, table: { kind: "table", rows: [columns, ...records.map((r) => columns.map((c) => r[c] ?? ""))] } };
}
