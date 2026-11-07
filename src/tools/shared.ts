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
});

export const programSchema = z.object({
  name: z.string(),
  kind: z.enum(PROGRAM_KINDS),
  startDate: z.string(),
  endDate: z.string(),
  aRace: z.object({ name: z.string(), date: z.string() }).nullable(),
  phases: z.array(phaseSchema).describe("In date order"),
});
