-- CRM Agent Bot - PostgreSQL schema
--
-- Design goals:
--   * One row per lead, sourced from many Google Sheets that grow over time
--     (4 new sheets per office per month).
--   * Keep the full original row as JSONB so KPI calculations stay identical to
--     the Google-Sheets path (same column keys) and new sheet columns never
--     require a migration.
--   * Index the hot dimensions (office, period, country) and both date columns
--     so multi-month reports (e.g. 6 months across every office) stay fast.
--
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS lead_rows (
  id            BIGSERIAL PRIMARY KEY,
  -- Stable identity of the originating sheet, e.g. "istanbul:2026-05:leads".
  source_key    TEXT        NOT NULL,
  office        TEXT,
  period        TEXT,                 -- 'YYYY-MM'
  lead_id       TEXT,                 -- the sheet "ID" column
  country       TEXT,
  lead_date     TIMESTAMPTZ,
  ftd_date      TIMESTAMPTZ,
  created       TIMESTAMPTZ,
  -- Full original row, keyed by the sheet header names. Calculations read this.
  data          JSONB       NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each sheet is re-ingested as a unit (delete by source_key + insert), so a
-- row's natural key is (source_key, lead_id). Allow re-sync idempotency.
CREATE INDEX IF NOT EXISTS lead_rows_source_key_idx ON lead_rows (source_key);
CREATE INDEX IF NOT EXISTS lead_rows_office_idx     ON lead_rows (office);
CREATE INDEX IF NOT EXISTS lead_rows_period_idx     ON lead_rows (period);
CREATE INDEX IF NOT EXISTS lead_rows_country_idx    ON lead_rows (country);
CREATE INDEX IF NOT EXISTS lead_rows_lead_date_idx  ON lead_rows (lead_date);
CREATE INDEX IF NOT EXISTS lead_rows_ftd_date_idx   ON lead_rows (ftd_date);

-- Registry of every sheet that n8n syncs. Lets the bot list offices/periods and
-- lets operators add "4 sheets per office per month" as data, not code.
CREATE TABLE IF NOT EXISTS lead_sources (
  source_key    TEXT PRIMARY KEY,
  office        TEXT,
  period        TEXT,
  category      TEXT,                 -- free label (brand / department / ...)
  spreadsheet_id TEXT,
  sheet_range   TEXT,
  row_count     INTEGER     NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
