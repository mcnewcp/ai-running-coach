import type { DocumentsReport } from "./documents";
import type { ImportReport } from "./index";

/** Whether every verification row matched and every record was imported. */
export function isClean(report: ImportReport): boolean {
  return report.unresolved.length === 0 && report.verification.every((row) => row.matches);
}

/** The report as plain text for the terminal. It holds Athlete Record data: never paste it anywhere public. */
export function formatReport(report: ImportReport): string {
  const lines: string[] = ["Verification (archive vs. imported):"];
  const width = Math.max(...report.verification.map((row) => row.measure.length));
  for (const row of report.verification) {
    lines.push(`  ${row.matches ? "ok  " : "DIFF"}  ${row.measure.padEnd(width)}  ${row.archive}  ${row.imported}`);
  }
  lines.push("", `Unresolved records (not imported): ${report.unresolved.length}`);
  for (const record of report.unresolved) {
    lines.push(`  ${record.source}  ${record.record} ${record.date}: ${record.reason}`);
  }
  lines.push("", `Warnings: ${report.warnings.length}`);
  for (const warning of report.warnings) lines.push(`  ${warning.source}  ${warning.message}`);
  return lines.join("\n");
}

/** Whether every document the vault should have is there, and every link was rewritten. */
export function documentsClean(report: DocumentsReport): boolean {
  return report.missing.length === 0 && report.unrewrittenLinks.length === 0;
}

/** The document import's report as plain text. It holds Athlete Record data: never paste it anywhere public. */
export function formatDocumentsReport(report: DocumentsReport): string {
  const lines: string[] = [`Documents written to the vault: ${report.written.length}`];
  lines.push("", `Missing from the vault: ${report.missing.length}`);
  for (const missing of report.missing) lines.push(`  ${missing.source}  ${missing.message}`);
  lines.push("", `Links that couldn't be rewritten (left as they were): ${report.unrewrittenLinks.length}`);
  for (const link of report.unrewrittenLinks) lines.push(`  ${link.source}  ${link.link}: ${link.reason}`);
  lines.push("", `Warnings: ${report.warnings.length}`);
  for (const warning of report.warnings) lines.push(`  ${warning.source}  ${warning.message}`);
  return lines.join("\n");
}
