-- Sustain-Release family tree schema.
-- Idempotent: safe to run repeatedly (npm run db:migrate).

CREATE TABLE IF NOT EXISTS people (
  id          serial PRIMARY KEY,
  -- Usually just a first name. Names are unique (case-insensitive), so a second
  -- "Alice" has to add an initial or nickname: "Alice K".
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Soft delete. Hidden from the tree but kept so an admin can restore them:
  --   UPDATE people SET deleted_at = NULL WHERE id = ...;
  deleted_at  timestamptz
);

ALTER TABLE people ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Names only need to be unique among people still on the tree, so a deleted
-- "Alice" doesn't block a new one.
DROP INDEX IF EXISTS people_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS people_name_unique_active
  ON people (lower(name))
  WHERE deleted_at IS NULL;

-- One row per (person, year) they attended. invited_by_id is NULL when the
-- person got in on their own (founders, artists, staff), came back on their
-- own in a later year, or nobody has said yet.
CREATE TABLE IF NOT EXISTS attendances (
  id            serial PRIMARY KEY,
  person_id     integer NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  year          integer NOT NULL CHECK (year BETWEEN 2014 AND 2100),
  invited_by_id integer REFERENCES people (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, year),
  CHECK (invited_by_id IS DISTINCT FROM person_id)
);

-- Festival rule: each attendee may bring exactly one guest per year.
CREATE UNIQUE INDEX IF NOT EXISTS attendances_one_guest_per_year
  ON attendances (invited_by_id, year)
  WHERE invited_by_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attendances_person_idx ON attendances (person_id);

-- Per-IP write rate limiting (see lib/rate-limit.ts). One row per IP per
-- minute window; old windows are pruned opportunistically.
CREATE TABLE IF NOT EXISTS rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
