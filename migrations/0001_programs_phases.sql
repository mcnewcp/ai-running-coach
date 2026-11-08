-- Programs and their Phases: how the season is structured.
--
-- Programs tile the calendar and Phases tile their Program, so every day
-- belongs to exactly one Phase. The domain core enforces the tiling. Recorded
-- sessions never store a Phase or Program: membership is derived from the date
-- (ADR 0003). All dates are local calendar dates, YYYY-MM-DD.

CREATE TABLE programs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('race_build', 'bridge')),
  start_date TEXT NOT NULL,
  -- For a race build, the A-race day.
  end_date TEXT NOT NULL,
  -- Race builds only.
  a_race_name TEXT,
  CHECK (start_date <= end_date),
  CHECK ((kind = 'race_build') = (a_race_name IS NOT NULL))
);

CREATE TABLE phases (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- race: the one-day Race Phase on a race build's A-race day.
  kind TEXT NOT NULL CHECK (kind IN ('training', 'race')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  focus TEXT,
  -- Free text, e.g. "20-25 mi/wk".
  mileage_target TEXT,
  UNIQUE (program_id, name),
  CHECK (start_date <= end_date)
);

CREATE INDEX phases_by_window ON phases (start_date, end_date);
