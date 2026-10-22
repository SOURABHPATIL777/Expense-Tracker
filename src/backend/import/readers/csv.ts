import "server-only";
import Papa from "papaparse";
import { cleanCell } from "@/backend/import/text";
import type { TableRead } from "@/backend/import/types";

export function readCsv(buffer: Buffer): TableRead {
  const text = buffer.toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return { kind: "table", rows: parsed.data.map((row) => row.map(cleanCell)) };
}
