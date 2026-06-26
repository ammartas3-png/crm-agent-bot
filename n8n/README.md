# n8n → Postgres ingestion

This folder contains a ready-to-import n8n workflow that periodically reads the
CRM Google Sheets and pushes their rows into the bot's `/api/ingest` endpoint,
which normalizes and stores them in PostgreSQL. The Telegram bot then answers
reports from Postgres (fast, multi-month) instead of reading every sheet live.

## Why this architecture

- **Many growing sheets** — 4 new sheets per office every month. Each sheet is a
  *source* identified by a stable `sourceKey` (e.g. `istanbul:2026-05:leads`).
  Adding sheets is data (a new row in the workflow's source list), not code.
- **6-month / cross-month reports** — Postgres indexes `lead_date`, `ftd_date`,
  `office`, `country` and `period`, so wide date ranges across every office stay
  fast. The KPI math is unchanged: the full original row is stored as JSONB and
  the bot runs the exact same calculations on it.
- **n8n is the scheduler/ETL only.** It does not compute KPIs; it just ships raw
  rows. All calculation criteria live in the bot so they cannot drift.

## Data flow

```
Schedule → Define Sources → Loop → Read Google Sheet → Aggregate → POST /api/ingest
                                                                       ↓
                                                        normalize + upsert (Postgres)
                                                                       ↓
                                                 Telegram bot reads Postgres for reports
```

## Setup

1. Apply the schema once:

   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```

2. Configure the app (Vercel env or `.env.local`):
   - `DATABASE_URL` — PostgreSQL connection string.
   - `INGEST_SECRET` — shared secret the workflow sends as `x-ingest-secret`.
   - Optionally `KV_REST_API_URL` / `KV_REST_API_TOKEN` for Redis result caching.

3. In n8n:
   - Import `n8n/crm-sheets-sync.json`.
   - Set environment variables `PUBLIC_APP_URL` and `INGEST_SECRET` in n8n.
   - Attach a Google credential to the **Read Google Sheet** node (a service
     account with read access to the spreadsheets).
   - Edit the **Define Sources** Code node to list every sheet to sync. Each
     entry needs `sourceKey`, `office`, `period`, `category`, `spreadsheetId`,
     `sheetName` and `range`.
   - Activate the workflow.

## Ingest request contract

`POST {PUBLIC_APP_URL}/api/ingest` with header `x-ingest-secret: <INGEST_SECRET>`:

```json
{
  "sourceKey": "istanbul:2026-05:leads",
  "office": "Istanbul",
  "period": "2026-05",
  "category": "leads",
  "spreadsheetId": "...",
  "sheetRange": "A:Y",
  "rows": [ { "ID": "1", "Country": "Turkey", "Lead Date": "11/05/2026", "...": "..." } ]
}
```

Notes:

- `rows` are header-keyed objects (n8n's Google Sheets node output). Alternatively
  send raw `values` (array of arrays); the endpoint converts them using the
  configured column layout.
- Each call **replaces** all stored rows for that `sourceKey`, so re-running the
  workflow is idempotent.
- Column names must match the sheet headers documented in the project README
  (`ID`, `Lead Date`, `FTD DATE`, `FTD MAKER`, `Diffrent Month`, `CR TARGET`,
  `LATE FTD +30 Day`, etc.) so the KPI calculations stay correct.
