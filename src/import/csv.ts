// A small CSV reader for the archive's files: comma-separated, a header row,
// and standard quoting (a quoted field may hold commas, newlines and doubled
// quotes).

/** One data row, by column name, with the 1-based line it starts on. */
export type CsvRow = { line: number; values: Record<string, string> };

/** The data rows of a CSV file, keyed by the header row's column names. */
export function parseCsv(text: string): CsvRow[] {
  const records = parseRecords(text);
  const header = records.shift();
  if (!header) return [];
  return records
    .filter(({ fields }) => !(fields.length === 1 && fields[0] === ""))
    .map(({ line, fields }) => ({
      line,
      values: Object.fromEntries(header.fields.map((name, i) => [name.trim(), fields[i] ?? ""])),
    }));
}

function parseRecords(text: string): { line: number; fields: string[] }[] {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = "";
      line++;
      recordLine = line;
    } else {
      field += char;
    }
  }
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  return records;
}
