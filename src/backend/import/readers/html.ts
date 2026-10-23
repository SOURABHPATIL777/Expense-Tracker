import "server-only";
import * as XLSX from "xlsx";
import type { ReadResult } from "@/backend/import/types";
import { looksLikeTransactionRow } from "@/backend/import/text";
import { workbookTable } from "./xlsx";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rupee: "₹" };

const decodeEntities = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

/** Visible text of an HTML page, one line per block (div, p, tr, li, br, headings). */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(script|style|head|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|li|h[1-6]|section|article|table|ul|ol)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "  ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * HTML statements: bank exports with <table>s become a table (every table with transactions);
 * activity pages built from blocks (e.g. Google Pay's Takeout "My Activity.html") become text
 * lines for the AI reader.
 */
export function readHtml(buffer: Buffer): ReadResult {
  const html = buffer.toString("utf8").replace(/^﻿/, "");
  if (/<table[\s>]/i.test(html)) {
    const table = workbookTable(XLSX.read(html, { type: "string", cellDates: false, cellNF: true }));
    if (table.rows.some(looksLikeTransactionRow)) return table;
  }
  return { kind: "text", lines: htmlToLines(html) };
}
