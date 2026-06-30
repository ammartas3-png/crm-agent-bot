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

## AI agent (admin-only Q&A) — built into the same bot

An optional natural-language layer **for admins only**, inside the **same report
bot** (no second bot): an admin asks about a desk, team leader, agent, country or
campaign and gets a grounded answer built from the same KPIs the dashboard uses.

### Same bot, no clutter

The bot doesn't show two crowded menus. Instead:

- The Start menu has a single **🤖 AI Assistant** entry (admins only), and
- the first time an admin just types a free-text question, the bot **asks once**:
  *"🤖 AI ile sor"* or *"📊 Hazır raporlar"*, then remembers the choice.

Commands: `/ai` enters AI chat mode; `/menu` (or the "Hazır Raporlara Dön"
button) leaves it.

> Why no Telegram-trigger workflow? Telegram allows only one receiver per bot and
> the report bot already owns the `/api/telegram` webhook. So the AI lives in the
> bot itself; n8n is only an **optional OpenAI relay** (below).

### How it is token-efficient

The LLM never sees raw rows:

```mermaid
flowchart LR
  TG["Telegram (admin)"] --> BOT["/api/telegram (same bot)"]
  BOT --> AGG["aiAgent.js: resolve entity + aggregate<br/>(leads/FTD/CR/status, breakdowns)"]
  AGG --> RES{"outOfScope?"}
  RES -- "yes" --> REF["Canned refusal in the user's language<br/>(no LLM, 0 tokens)"]
  RES -- "no" --> SMALL["compact facts JSON + messages"]
  SMALL --> LLM["OpenAI (direct) OR n8n relay<br/>— only rephrases"]
  LLM --> REPLY["Telegram reply (draftAnswer fallback)"]
```

- The bot resolves the question to an **entity** (agent / team leader / desk /
  country / campaign / brand / placement) or an **overview**, then aggregates a
  small, rounded `facts` object (totals, per-country/campaign/agent breakdowns,
  status shares such as no-answer / call-again). Only that compact JSON — never
  the rows — is sent to the LLM.
- **Out-of-scope** questions are answered with a canned refusal **in the user's
  language**, with no LLM call.
- A deterministic `draftAnswer` is the fallback when no LLM is configured or the
  call fails, so the bot always answers.

### Setup

1. Set the admins (`ADMIN_USERS`) correctly — AI is admin-only.
2. Choose how the LLM is called:
   - **Direct OpenAI:** set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`,
     default `gpt-4o-mini`) on the app. Nothing else needed.
   - **Via n8n (keep the key in n8n):** import `crm-ai-openai-relay.json` as a
     **new, separate workflow** — do NOT modify your existing dashboard/report
     bridge. It uses its own webhook path (`/webhook/crm-ai`), so it won't
     collide. Activate it and set `AI_N8N_WEBHOOK_URL` on the app to that
     webhook's URL. The bot POSTs `{ messages, question }`; n8n runs OpenAI and
     responds `{ text }`. (If OpenAI errors, the node continues and the bot uses
     its deterministic fallback.)
   - **Neither:** the bot replies with the deterministic draft answer.

### `/api/ai` (optional external callers)

The same context is also exposed as an admin-only endpoint for external tools.
`POST {PUBLIC_APP_URL}/api/ai` with header `x-ai-secret: <AI_AGENT_SECRET>`
(falls back to `INGEST_SECRET`):

```json
{ "question": "Ali ajanı hangi ülkede iyi?", "telegramUserId": 12345678 }
```

Returns either `{ "outOfScope": true, "refusal": "...", "language": "tr" }` or
`{ "outOfScope": false, "intent": {...}, "facts": {...}, "draftAnswer": "...", "messages": [...] }`.

### What it can answer (question taxonomy)

The agent maps a question to whatever metrics/rows are relevant. Examples:

- **Desk** → which team leaders/teams work in it and how each performs
  (leads, FTD, CR, target reach), strongest/weakest countries & campaigns.
  - "Istanbul masasında hangi takımlar var, performansları nasıl?"
- **Team leader** → their agents ranked, best vs weakest agent, team totals.
  - "Lider 2'nin ajanları nasıl, en zayıf kim?"
- **Agent** → where they are strong vs weak by country/campaign, status
  problems (high no-answer, high call-again with low FTD), CR vs target.
  - "Ahmet hangi ülke/kampanyada iyi, nerede kötü? No-answer'ı yüksek mi?"
- **Country** → top desks/campaigns/agents in that country, totals, CR.
  - "Almanya'da en iyi masa ve kampanya hangisi?"
- **Campaign / brand / placement** → countries/desks/agents driving it.
- **Overview / metric + date** → "Bu ay kaç FTD?", "Dünkü en iyi 5 ajan?".

Other useful patterns it supports: "Which agents have many call-agains but no
FTD?", "Compare Germany vs Turkey CR target reach", "Worst desks by target
reach this month", "Top campaigns by FTD in Spain".
