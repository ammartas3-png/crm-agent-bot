# n8n ingestion (SQL-less)

This folder contains ready-to-import n8n workflows that read the CRM Google
Sheets and store them in Redis (via the app's `/api/ingest` or `/api/sources`
endpoints). The **web dashboard**, Telegram bot, and AI agent then read from
that dataset when `DASHBOARD_SOURCE=auto` / `LEADS_SOURCE=auto`.

## Redis daily sync (recommended for the dashboard)

Import **`crm-redis-daily-sync.json`**. It runs **every day at 12:00 and 18:00**
(workflow timezone, default `Europe/Istanbul`) and syncs **one office/month per
request** (avoids Vercel/n8n timeouts):

```
App Config → GET /api/sources → loop → POST /api/sources?sourceKey=...
```

The app reads every office/month spreadsheet from your **Bot Authority** registry,
stores **Leads + FTD + Info Agents** in Redis, and the dashboard serves reports
from Redis instead of reading Google Sheets live.

### Required configuration

**Vercel (app):**

- `REDIS_URL=redis://default:PASSWORD@HOST:PORT` — your Redis Cloud link, **or**
  `KV_REST_API_URL` + `KV_REST_API_TOKEN` for Upstash REST.
- `INGEST_SECRET` — shared secret for sync endpoints.
- `DASHBOARD_SOURCE=auto` — dashboard uses Redis when data is synced (default).
- `GOOGLE_AUTHORITY_SPREADSHEET_ID` — Bot Authority registry with the Offices tab.

**n8n (no environment variables required):**

Import `crm-redis-daily-sync.json`, open the **App Config** node, and edit
these two lines at the top of the code:

```javascript
const PUBLIC_APP_URL = 'https://crm-agent-bot-hj5k.vercel.app';
const INGEST_SECRET = 'your-secret-from-vercel';
```

Use the **production** Vercel URL (not the long preview deployment URL).
`INGEST_SECRET` must match Vercel exactly. Then activate the workflow.

If your n8n plan supports environment variables, you may still use
`PUBLIC_APP_URL` and `INGEST_SECRET` there instead — but it is optional.

### Manual sheet list (alternative)

If you prefer to paste spreadsheet IDs directly in n8n, import
**`crm-sheets-redis-manual.json`**, edit **Define Sources**, attach a Google
service-account credential, and activate. It uses the same 12:00 / 18:00 schedule
and pushes rows to `POST /api/ingest`.

## Working map

```mermaid
flowchart TD
  A["Bot Authority sheet<br/>Offices tab: office x month -> spreadsheet id<br/>users tab: authorized users"]
  S["Scheduler (n8n / Vercel Cron)"]
  POST["POST /api/sources<br/>(x-ingest-secret)"]
  R["registry.js<br/>parse Offices + users"]
  T["tabResolver.js<br/>auto-detect data tab per file<br/>(match CRM column headers)"]
  G["Office Google Sheets<br/>(per office, per month)"]
  ST["leadsStore.js<br/>Redis/KV + in-memory dataset"]
  CALC["calculations.js<br/>Total/Valid Leads, FTD, CR,<br/>CR Target Reach, Late FTD"]
  REP["GET /api/report<br/>summary + quick reports (JSON)"]
  TG["Telegram bot<br/>guided menu + quick reports"]
  N8N["n8n: Show Metrics node<br/>(rows / columns / dashboard)"]

  S --> POST --> R --> T --> G --> ST
  R -->|users tab| AUTH["permissions<br/>authorized users"]
  ST --> CALC
  CALC --> REP --> N8N
  CALC --> TG
  A -. read .-> R
```

## Endpoints (all protected by `INGEST_SECRET`)

- `GET /api/sources` — list discovered sheets (`?includeUsers=1` for the users tab).
- `POST /api/sources` — registry-driven sync: detects each file's data tab and
  stores it; refreshes authorized users. Narrow with `?period=` / `?sourceKey=`.
- `GET /api/report` — dashboard + quick reports as JSON. Query: `type`
  (`all|summary|quick`), `office`, `country`, `agent`, `campaign`, `teamLeader`,
  `status`, `date` (`today|yesterday|thisMonth|lastMonth`) or `start`+`end`,
  `limit`. This is what the dashboard workflow surfaces inside n8n.

## Different tabs per file

Office files do not have to name their data tab `Leads`. During sync,
`tabResolver` lists each file's tabs and picks the one(s) whose header row
matches the CRM columns (`ID`, `Country`, `FTD MAKER`, `Lead Date`, …), so the
correct sheet is read automatically regardless of its name.

## Two ways to set this up — pick one

### Option A — Bot Authority registry (recommended, least n8n work)

Keep a **Bot Authority** spreadsheet whose `Offices` tab maps office × month to
each data spreadsheet ID (and a `users` tab for authorized users). Then n8n does
**not** need any Google Sheets nodes — just one scheduled HTTP call:

```
Schedule → HTTP Request: POST {PUBLIC_APP_URL}/api/sources
           header x-ingest-secret: {INGEST_SECRET}
```

Import `crm-registry-sync.json` for exactly this. The bot reads the registry,
detects each file's data tab, pulls the rows, stores them, and (if
`AUTHORIZE_FROM_REGISTRY` is on) refreshes authorized users from the `users` tab.
Narrow large syncs with `?period=YYYY-MM` or `?sourceKey=...`.

To also see the **metrics, rows, columns and quick reports inside n8n**, import
`crm-dashboard.json`: it syncs, then calls `GET /api/report?type=all` and surfaces
the summary + top agents/countries + status distribution in a Show Metrics node.

Why this is easier when sheets grow: adding "4 sheets per office per month" is
editing a spreadsheet, not editing/redeploying an n8n workflow. The service
account must be shared on the registry **and** on every office sheet it lists.

### Option B — define the sheet IDs in n8n (no registry sheet)

If you prefer to keep the list inside n8n, import `crm-sheets-sync.json` and edit
the **Define Sources** Code node — paste the office/month/spreadsheetId rows
there. n8n then reads each Google Sheet and pushes it to `/api/ingest`. This is
fine for a small, fairly static list; you edit the workflow whenever sheets are
added. The workflow below describes this option.

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
