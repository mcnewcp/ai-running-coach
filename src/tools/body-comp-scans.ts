import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { deleteBodyCompScan, logBodyCompScan, updateBodyCompScan } from "../core/body-comp-scans";
import { attributed, attribution, date, id, number, structured, text } from "./shared";

/** The Body-comp Scan tools: logging, correcting and deleting body-composition scans. */
export function registerBodyCompScanTools(server: McpServer, env: Env) {
  const db = env.DB;
  const metrics = {
    weight: number("Weight, in the runner's usual unit (e.g. lb)"),
    skeletalMuscleMass: number("Skeletal muscle mass, same unit as weight"),
    bodyFatMass: number("Body fat mass, same unit as weight"),
    bodyFatPercent: number("Percent body fat, 0-100"),
    bmi: number("Body mass index"),
    totalBodyWater: number("Total body water, as printed"),
    leanBodyMass: number("Lean body mass, same unit as weight"),
    visceralFatLevel: number("Visceral fat level"),
    basalMetabolicRate: number("Basal metabolic rate, kcal"),
    score: number("The scan's overall score, if the printout gives one"),
    notes: text("Anything else worth keeping from the printout"),
  };
  const bodyCompScanSchema = z.object({
    id: z.number(),
    date: z.string(),
    weight: z.number().nullable(),
    skeletalMuscleMass: z.number().nullable(),
    bodyFatMass: z.number().nullable(),
    bodyFatPercent: z.number().nullable(),
    bmi: z.number().nullable(),
    totalBodyWater: z.number().nullable(),
    leanBodyMass: z.number().nullable(),
    visceralFatLevel: z.number().nullable(),
    basalMetabolicRate: z.number().nullable(),
    score: z.number().nullable(),
    notes: z.string().nullable(),
  });
  const bodyCompScanWrite = z.object({ bodyCompScan: bodyCompScanSchema, ...attributed });

  server.registerTool(
    "log_body_comp_scan",
    {
      title: "Log a Body-comp Scan",
      description:
        "Records one body-composition scan. Give only the metrics the printout shows: never estimate or derive the others. " +
        attribution,
      inputSchema: z.object({ date: date("The day of the scan"), ...metrics }),
      outputSchema: bodyCompScanWrite,
    },
    async (input) => structured(await logBodyCompScan(db, input)),
  );

  server.registerTool(
    "update_body_comp_scan",
    {
      title: "Correct a Body-comp Scan",
      description:
        "Corrects a logged Body-comp Scan. Fields you leave out keep their value; null clears one. " + attribution,
      inputSchema: z.object({
        id: id("Body-comp Scan"),
        date: date("The corrected day of the scan").optional(),
        ...metrics,
      }),
      outputSchema: bodyCompScanWrite,
    },
    async (input) => structured(await updateBodyCompScan(db, input)),
  );

  server.registerTool(
    "delete_body_comp_scan",
    {
      title: "Delete a Body-comp Scan",
      description: "Deletes a Body-comp Scan logged by mistake. Returns what was deleted.",
      inputSchema: z.object({ id: id("Body-comp Scan") }),
      outputSchema: z.object({ deleted: bodyCompScanSchema }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => structured(await deleteBodyCompScan(db, id)),
  );
}
