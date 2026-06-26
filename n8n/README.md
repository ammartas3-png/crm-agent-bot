# n8n ingestion (SQL-less)

This folder contains a ready-to-import n8n workflow that periodically reads the
CRM Google Sheets and pushes their rows into the bot's `/api/ingest` endpoint,
which stores them in Redis/KV plus an in-memory dataset (no SQL database). The
Telegram bot then answers reports from that dataset instead of reading every
sheet live.

## Simplest option: let the bot read the Bot Authority registry

If you keep a **Bot Authority** spreadsheet whose `Offices` tab maps office ×
month to each data spreadsheet ID (see the project README), you do not need to
wire Google Sheets nodes in n8n at all. Just schedule a single HTTP call:

```
Schedule → HTTP Request: POST {PUBLIC_APP_URL}/api/sources
           header x-ingest-secret: {INGEST_SECRET}
```

The bot reads the registry, pulls each office sheet itself, and stores the rows.
Narrow large syncs with `?period=YYYY-MM` or `?sourceKey=...`. The service account
must be shared on the registry and on every office sheet it lists.

The workflow below is the alternative where n8n reads the sheets and pushes them.

## Why this architecture

- **Many growing sheets** — 4 new sheets per office every month. Each sheet is a
  *source* identified by a stable `sourceKey` (e.g. `istanbul:2026-05:leads`).
  Adding sheets is data (a new row in the workflow's source list), not code.
- **Small data, no SQL** — rows are kept as JSON per source. The KPI math is
  unchanged: rows are stored exactly as they come from the sheet and the bot runs
  the exact same calculations on them.
- **n8n is the scheduler/ETL only.** It does not compute KPIs; it just ships raw
  rows. All calculation criteria live in the bot so they cannot drift.

## Data flow

```
Schedule → Define Sources → Loop → Read Google Sheet → Aggregate → POST /api/ingest
                                                                       ↓
                                                  store rows (Redis/KV + in-memory)
                                                                       ↓
                                              Telegram bot reads the dataset for reports
```

## Setup

1. Configure the app (Vercel env or `.env.local`):
   - `INGEST_SECRET` — shared secret the workflow sends as `x-ingest-secret`.
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` /
     `UPSTASH_REDIS_REST_TOKEN`) so the dataset survives serverless cold starts.
     Without KV the dataset lives in memory and is rebuilt on the next sync.

2. In n8n:
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
- Set `LEADS_SOURCE=ingest` to force the bot to use ingested data, or leave it on
  `auto` to use ingested data when present and fall back to Google Sheets.
