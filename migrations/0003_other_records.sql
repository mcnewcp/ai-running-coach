-- Strength Sessions, Daily Check-ins, Body-comp Scans and Race Results.
--
-- Like every recorded session, none of them stores a Phase or Program:
-- membership is derived from the date (ADR 0003). All dates are local
-- calendar dates, YYYY-MM-DD. Optional measures are NULL when not reported.

CREATE TABLE strength_sessions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  -- e.g. Upper, Lower or Mix.
  session_type TEXT,
  notes TEXT
);

CREATE INDEX strength_sessions_by_date ON strength_sessions (date);

-- One entry per exercise performed in a Strength Session.
CREATE TABLE exercise_entries (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES strength_sessions (id) ON DELETE CASCADE,
  -- The entry's place in the session, from 0.
  position INTEGER NOT NULL,
  -- The movement pattern, e.g. Squat, Hinge, Push, Pull.
  pattern TEXT,
  exercise TEXT NOT NULL,
  load REAL,
  -- What the load means, e.g. "per hand", "total", "bodyweight".
  load_basis TEXT,
  sets INTEGER,
  -- Free text, e.g. "10", "8 each side", "30 s".
  reps_per_set TEXT,
  notes TEXT,
  UNIQUE (session_id, position)
);

-- At most one per date: a later report for the same date updates it.
CREATE TABLE check_ins (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  sleep_hours REAL,
  sleep_quality REAL,
  resting_hr INTEGER,
  -- Pain ratings, 0-10: left and right knee in v0.1, matching the legacy fields.
  left_knee_pain REAL,
  right_knee_pain REAL,
  energy REAL,
  motivation REAL,
  life_stress REAL,
  body_weight REAL,
  notes TEXT
);

-- One body-composition measurement. Only the metrics the printout shows are
-- recorded; the rest stay NULL.
CREATE TABLE body_comp_scans (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  weight REAL,
  skeletal_muscle_mass REAL,
  body_fat_mass REAL,
  body_fat_percent REAL,
  bmi REAL,
  total_body_water REAL,
  lean_body_mass REAL,
  visceral_fat_level REAL,
  basal_metabolic_rate REAL,
  score REAL,
  notes TEXT
);

CREATE INDEX body_comp_scans_by_date ON body_comp_scans (date);

-- The official outcome of one race. Whether it's an A-race or a Tune-up Race
-- is derived from whether a Program names it, never stored.
CREATE TABLE race_results (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  -- The race distance as named, e.g. 5K, 10K, Half Marathon. PRs are per distance.
  distance TEXT NOT NULL,
  official_time_seconds INTEGER NOT NULL,
  -- Free text, e.g. "7:38/mi".
  pace TEXT,
  conditions TEXT,
  avg_hr INTEGER,
  -- Free text, e.g. "12/340 overall, 2/25 AG".
  placement TEXT,
  -- The vault path of the race narrative, e.g. Races/2027-04-11-synthetic-city-half.md.
  narrative_path TEXT,
  notes TEXT
);

CREATE INDEX race_results_by_date ON race_results (date);
