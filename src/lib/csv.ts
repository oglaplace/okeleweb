/**
 * CSV, parsed in the browser.
 *
 * Deliberately not a server-side spreadsheet reader. Parsing xlsx on the API
 * would mean a binary dependency and an opaque failure whenever a column is
 * named something unexpected — and column names are exactly what differs
 * between two secretaries' files. Parsing here lets the console show the
 * mapping and the first rows BEFORE anything is written, so a wrong column is
 * caught while it is still free.
 *
 * Excel exports CSV from "Enregistrer sous"; that is the documented path.
 *
 * Handles the three things a real export actually contains: quoted fields,
 * doubled quotes inside them, and semicolons — which is what Excel emits in a
 * French locale, where the comma is the decimal separator.
 */
export interface ParsedCsv {
  headings: string[];
  rows: Record<string, string>[];
}

/** Whichever of , ; or tab appears most on the heading line wins. */
function sniffDelimiter(line: string): string {
  const counts = [",", ";", "\t"].map((d) => ({
    d,
    n: line.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ",";
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

export function parseCsv(text: string): ParsedCsv {
  // A BOM survives every Excel export and would make the first heading
  // "﻿Nom", which matches nothing.
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (!lines.length) return { headings: [], rows: [] };

  const delimiter = sniffDelimiter(lines[0]!);
  const headings = splitLine(lines[0]!, delimiter).filter((h) => h.length > 0);

  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delimiter);
    const row: Record<string, string> = {};
    headings.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });

  return { headings, rows };
}
