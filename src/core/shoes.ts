import { parseDate } from "./calendar";
import { DomainError } from "./errors";
import { roundMiles } from "./mileage-cap";

// Shoes: pairs of running shoes tracked for accumulated mileage. A Shoe's
// mileage and its first and last Run dates are always derived from the Runs
// worn in it, never stored.

/** Where a pair is flagged as nearing replacement, unless it sets its own threshold. */
export const DEFAULT_WARN_AT_MILES = 300;

export const SHOE_STATUSES = ["active", "retired"] as const;
export type ShoeStatus = (typeof SHOE_STATUSES)[number];

export type Shoe = {
  /** The runner's identifier for the pair, e.g. trainer-blue. */
  id: string;
  model: string | null;
  status: ShoeStatus;
  retiredDate: string | null;
  notes: string | null;
  /** Derived: total miles of the Runs worn in it. */
  mileage: number;
  /** Derived: how many Runs were worn in it. */
  runs: number;
  /** Derived: the date of its first Run. */
  firstRun: string | null;
  /** Derived: the date of its last Run. */
  lastRun: string | null;
  /** The mileage at which it's flagged as nearing replacement. */
  warnAtMiles: number;
  /** Whether its mileage has reached warnAtMiles. */
  nearingReplacement: boolean;
};

export type ShoeInput = {
  id: string;
  model?: string | null;
  notes?: string | null;
  warnAtMiles?: number | null;
};

/** Adds a pair of shoes. Fails if one with the same identifier exists. */
export async function addShoe(db: D1Database, input: ShoeInput): Promise<Shoe> {
  const id = input.id.trim();
  if (id === "") throw new DomainError("A Shoe needs an identifier, e.g. trainer-blue.");
  const warnAtMiles = input.warnAtMiles ?? DEFAULT_WARN_AT_MILES;
  if (!(warnAtMiles > 0)) throw new DomainError(`warnAtMiles must be more than 0 miles, got ${warnAtMiles}.`);
  if (await findShoe(db, id)) throw new DomainError(`There's already a Shoe ${id}.`);
  await db
    .prepare("INSERT INTO shoes (id, model, status, warn_at_miles, notes) VALUES (?, ?, 'active', ?, ?)")
    .bind(id, input.model ?? null, warnAtMiles, input.notes ?? null)
    .run();
  return getShoe(db, id);
}

/**
 * Retires a pair on `date`: it stops being listed as active, keeping its
 * Runs. Fails if it has Runs after that date.
 */
export async function retireShoe(db: D1Database, id: string, date: string): Promise<Shoe> {
  parseDate(date);
  const shoe = await getShoe(db, id);
  if (shoe.lastRun !== null && shoe.lastRun > date) {
    throw new DomainError(
      `Shoe ${id} has Runs up to ${shoe.lastRun}, so it can't be retired on ${date}. Retire it on or after its last Run.`,
    );
  }
  await db.prepare("UPDATE shoes SET status = 'retired', retired_date = ? WHERE id = ?").bind(date, id).run();
  return getShoe(db, id);
}

/** The pairs, sorted by identifier: active ones only, unless `includeRetired`. */
export async function listShoes(db: D1Database, { includeRetired = false } = {}): Promise<Shoe[]> {
  return selectShoes(db, includeRetired ? "" : "WHERE s.status = 'active'", []);
}

/** The pair with identifier `id`. Fails if there's none. */
export async function getShoe(db: D1Database, id: string): Promise<Shoe> {
  const shoe = await findShoe(db, id);
  if (!shoe) throw new DomainError(`There's no Shoe ${id}. Add it with add_shoe first.`);
  return shoe;
}

/** The pair with identifier `id`, or null. */
export async function findShoe(db: D1Database, id: string): Promise<Shoe | null> {
  const [shoe] = await selectShoes(db, "WHERE s.id = ?", [id]);
  return shoe ?? null;
}

/**
 * Fails unless a Run on `date` can be worn in Shoe `id`: the pair exists and
 * wasn't retired before that date.
 */
export async function checkShoeForRun(db: D1Database, id: string, date: string): Promise<void> {
  const shoe = await getShoe(db, id);
  if (shoe.retiredDate !== null && date > shoe.retiredDate) {
    throw new DomainError(`Shoe ${id} was retired on ${shoe.retiredDate}, before this Run on ${date}.`);
  }
}

type ShoeRow = {
  id: string;
  model: string | null;
  status: ShoeStatus;
  retired_date: string | null;
  warn_at_miles: number;
  notes: string | null;
  mileage: number;
  runs: number;
  first_run: string | null;
  last_run: string | null;
};

async function selectShoes(db: D1Database, where: string, binds: unknown[]): Promise<Shoe[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, COALESCE(SUM(r.distance_miles), 0) AS mileage, COUNT(r.id) AS runs,
         MIN(r.date) AS first_run, MAX(r.date) AS last_run
       FROM shoes s LEFT JOIN runs r ON r.shoe_id = s.id
       ${where}
       GROUP BY s.id ORDER BY s.id`,
    )
    .bind(...binds)
    .all<ShoeRow>();
  return results.map((row) => {
    const mileage = roundMiles(row.mileage);
    return {
      id: row.id,
      model: row.model,
      status: row.status,
      retiredDate: row.retired_date,
      notes: row.notes,
      mileage,
      runs: row.runs,
      firstRun: row.first_run,
      lastRun: row.last_run,
      warnAtMiles: row.warn_at_miles,
      nearingReplacement: mileage >= row.warn_at_miles,
    };
  });
}
