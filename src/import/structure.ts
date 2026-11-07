import type { ProgramInput } from "../core/programs";
import { type ArchiveSource, readRequired } from "./archive";

// The runner's season structure and legacy-label mapping. Working out
// Programs and Phases from the archive's goal and plan documents takes
// judgement, so it's done once and reviewed, like the other extraction files,
// and kept in the private archive as extraction/structure.json. Nothing
// specific to one runner lives in this repo.

export const STRUCTURE_PATH = "extraction/structure.json";

export type Structure = {
  /** Every Program with its whole Phase layout, as upsert_program takes them. */
  programs: ProgramInput[];
  /**
   * Where each legacy free-text training_goal label belongs: a Program, and
   * a Phase if the label named one. Records are placed by their date (ADR
   * 0003); the labels only cross-check that.
   */
  legacyLabels: Record<string, { program: string; phase?: string }>;
  checkIns: {
    /** The 0-10 rating for each sleep-quality word in the extracted Check-ins, e.g. { "good": 8 }. */
    sleepQuality: Record<string, number>;
  };
};

export function readStructure(archive: ArchiveSource): Structure {
  const parsed = JSON.parse(readRequired(archive, STRUCTURE_PATH)) as Partial<Structure>;
  if (!Array.isArray(parsed.programs)) throw new Error(`${STRUCTURE_PATH} needs a "programs" list.`);
  return {
    programs: parsed.programs,
    legacyLabels: parsed.legacyLabels ?? {},
    checkIns: { sleepQuality: parsed.checkIns?.sleepQuality ?? {} },
  };
}
