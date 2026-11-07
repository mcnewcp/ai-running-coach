import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MAX_QUERY_ROWS, runQuery } from "../core/query";
import { structured } from "./shared";

/**
 * The structured Athlete Record's schema, for writing queries. Each table is
 * one `- table(columns): notes` line; a test checks the lines match the
 * database, so keep that shape when the schema changes.
 */
const SCHEMA = `Schema (SQLite). Dates are local calendar dates, TEXT YYYY-MM-DD, so compare them as strings. Unreported measures are NULL.
- programs(id, name, kind, start_date, end_date, a_race_name): kind is race_build or bridge. Programs tile the calendar. A race build ends on its A-race day (end_date); a_race_name is NULL for a bridge.
- phases(id, program_id, name, kind, start_date, end_date, focus, mileage_target, plan_path): program_id references programs.id. kind is training or race (the one-day Race Phase). Phases tile their Program. mileage_target is free text. plan_path is the vault path of the Phase's Plan.
- runs(id, date, type, distance_miles, duration_seconds, avg_hr, vo2_max, shoe_id, left_knee_pain, right_knee_pain, notes): shoe_id references shoes.id. Pain ratings are 0-10. Pace in seconds per mile is duration_seconds / distance_miles.
- shoes(id, model, status, retired_date, warn_at_miles, notes): status is active or retired. A Shoe's mileage is SUM(runs.distance_miles) over its Runs; it isn't stored.
- strength_sessions(id, date, session_type, notes)
- exercise_entries(id, session_id, position, pattern, exercise, load, load_basis, sets, reps_per_set, notes): one per exercise; session_id references strength_sessions.id, position orders them from 0. reps_per_set is free text.
- check_ins(id, date, sleep_hours, sleep_quality, resting_hr, left_knee_pain, right_knee_pain, energy, motivation, life_stress, body_weight, notes): the Daily Check-ins, at most one per date. Ratings are 0-10.
- body_comp_scans(id, date, weight, skeletal_muscle_mass, body_fat_mass, body_fat_percent, bmi, total_body_water, lean_body_mass, visceral_fat_level, basal_metabolic_rate, score, notes)
- race_results(id, date, name, distance, official_time_seconds, pace, conditions, avg_hr, placement, narrative_path, notes): distance is as named (5K, Half Marathon…). It's the A-race if a race-build Program ends on its date and LOWER(TRIM(a_race_name)) = LOWER(TRIM(name)); otherwise a Tune-up Race.
No record stores its Phase or Program: join on the date, e.g. JOIN phases ph ON r.date BETWEEN ph.start_date AND ph.end_date. Weeks run Monday–Sunday: date(r.date, 'weekday 0', '-6 days') is a date's Monday.`;

/** The analysis tool: read-only SQL over the structured Athlete Record. */
export function registerQueryTools(server: McpServer, db: D1Database) {
  server.registerTool(
    "query",
    {
      title: "Query the Athlete Record",
      description:
        "Runs one read-only SQL SELECT statement (WITH … SELECT is fine) against the runner's structured Athlete Record, " +
        "for ad-hoc analysis questions, e.g. easy-run heart rate at the same pace then vs. now, or pain ratings against weekly mileage. " +
        "Anything else (writes, PRAGMA, ATTACH, more than one statement) is rejected before it runs. " +
        `It returns at most ${MAX_QUERY_ROWS} rows, so aggregate in SQL where you can. ` +
        "Use the domain tools to record or change anything.\n\n" +
        SCHEMA,
      inputSchema: z.object({ sql: z.string().describe("One SQLite SELECT statement") }),
      outputSchema: z.object({
        columns: z.array(z.string()).describe("The result's column names, in order"),
        rows: z.array(z.array(z.unknown())).describe("Each row's values, in column order"),
        truncated: z.boolean().describe(`Whether rows beyond the first ${MAX_QUERY_ROWS} were left out`),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ sql }) => structured(await runQuery(db, sql)),
  );
}
