import { z } from "zod";
import { PHASE_KINDS, PROGRAM_KINDS } from "../core/programs";

/** A local calendar date input, described for the coach. */
export function date(description: string) {
  return z.string().describe(`${description}: a local calendar date, YYYY-MM-DD`);
}

/** A tool result carrying `output` as structured content, and as JSON text for clients without it. */
export function structured<T extends Record<string, unknown>>(output: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

export const phaseSchema = z.object({
  name: z.string(),
  kind: z.enum(PHASE_KINDS),
  startDate: z.string(),
  endDate: z.string(),
  focus: z.string().nullable(),
  mileageTarget: z.string().nullable(),
  planPath: z
    .string()
    .nullable()
    .describe("The vault path of the Phase's Plan document, or null if none is linked. The document may not be written yet."),
});

/** A document as read, with the version to pass back when writing it. */
export const documentSchema = z.object({
  path: z.string(),
  content: z.string().describe("The whole markdown document"),
  version: z.string().describe("The document's version. Pass it to write_document as expected_version to update the document."),
});

export const programSchema = z.object({
  name: z.string(),
  kind: z.enum(PROGRAM_KINDS),
  startDate: z.string(),
  endDate: z.string(),
  aRace: z.object({ name: z.string(), date: z.string() }).nullable(),
  phases: z.array(phaseSchema).describe("In date order"),
});

/** What each dated record's write tool says about its Phase and unreported fields. */
export const attribution =
  "Records are never labelled with a Phase: the write returns the Program and Phase the date falls in, " +
  "and is rejected if no Phase covers it. Leave out anything the runner didn't report: it stays empty.";

/** The Program and Phase a dated record's write returns, as output schema fields. */
export const attributed = {
  program: programSchema.omit({ phases: true }).describe("The Program the record's date falls in"),
  phase: phaseSchema.describe("The Phase the record's date falls in"),
};

/** A record's numeric id input. */
export function id(noun: string) {
  return z.number().int().describe(`The ${noun}'s id, as returned when it was logged`);
}

/** An optional text input: omit to leave it (or keep it, in a correction), null to clear it. */
export function text(description: string) {
  return z.string().nullish().describe(description);
}

/** An optional number input: omit to leave it (or keep it, in a correction), null to clear it. */
export function number(description: string) {
  return z.number().nullish().describe(description);
}
