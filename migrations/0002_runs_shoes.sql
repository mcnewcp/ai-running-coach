-- Runs and the Shoes they're run in.
--
-- A Run never stores its Phase or Program: membership is derived from its
-- date (ADR 0003). A Shoe never stores its mileage or its first and last Run
-- dates: they're derived from its Runs. All dates are local calendar dates,
-- YYYY-MM-DD.

CREATE TABLE shoes (
  -- The runner's identifier for the pair, e.g. "pegasus-blue".
  id TEXT PRIMARY KEY,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  retired_date TEXT,
  -- The mileage at which the pair is flagged as nearing its replacement window.
  warn_at_miles REAL NOT NULL CHECK (warn_at_miles > 0),
  notes TEXT,
  CHECK ((status = 'retired') = (retired_date IS NOT NULL))
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT,
  distance_miles REAL NOT NULL CHECK (distance_miles > 0),
  duration_seconds INTEGER CHECK (duration_seconds > 0),
  avg_hr INTEGER,
  vo2_max REAL,
  shoe_id TEXT REFERENCES shoes (id),
  -- Pain ratings, 0-10.
  left_knee_pain INTEGER,
  right_knee_pain INTEGER,
  notes TEXT
);

CREATE INDEX runs_by_date ON runs (date);
CREATE INDEX runs_by_shoe ON runs (shoe_id);
