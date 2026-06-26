# CRM Agent Bot

Telegram reporting bot for CRM data in Google Sheets.

## Goal

Users ask questions in Telegram, the bot reads authorized Google Sheets tabs,
calculates simple metrics, and replies with a short answer.

## Stack

- Next.js App Router
- Vercel deployment
- Telegram webhook
- Google Sheets API
- Node.js
- Optional: PostgreSQL + n8n (historical/multi-sheet reporting) and Redis/KV
  (state persistence + result cache)

## Structure

```text
app/api/telegram/route.js
app/api/ingest/route.js        # n8n → PostgreSQL ingestion (optional)
lib/telegram.js
lib/googleSheets.js
lib/dataProvider.js            # reads from PostgreSQL or Google Sheets
lib/leadsRepository.js         # PostgreSQL queries (optional)
lib/sheetRowMapper.js          # sheet row → DB record (KPI columns preserved)
lib/db.js                      # PostgreSQL pool (optional)
lib/cache.js                   # in-memory + Redis result cache
lib/store.js                   # Redis/KV state persistence (optional)
lib/queryRouter.js
lib/calculations.js
lib/permissions.js
config/sheetsConfig.js
db/schema.sql                  # PostgreSQL schema
n8n/crm-sheets-sync.json       # importable n8n workflow
```

## Supported MVP questions

- `How many FTD today?`
- `Germany total leads?`
- `Ahmet total calls?`
- `May Turkey leads count?`
- `Germany CR this month`
- `Show top agents by FTD`
- `Show FTD by hour`

The query router is intentionally simple for the MVP. Later, OpenAI can be added
inside `lib/queryRouter.js` without changing the Telegram webhook or calculation
modules.

## Guided Telegram menu

Sending `/start`, `hello`, `hi`, `selam`, or `merhaba` opens an inline keyboard
menu:

- Report by Country
- Report by Office
- Report by Team Leader
- Report by Agent
- Report by Brand
- Report by Campaign
- Date / Hour Analysis
- Top Performers
- Status Distribution

The bot reads available filter values dynamically from the Google Sheet. For
example, choosing **Report by Country** loads country values from the Country
column, asks the user to select one, then asks for a date range.

Date range buttons:

- Today
- Yesterday
- This Month
- Last Month
- Custom Range (`DD/MM/YYYY - DD/MM/YYYY`)
- All Data

The report output uses one generic report engine:

```js
generateReport({ groupField, selectedValue, dateRange })
```

Global KPI formulas:

- Raw Lead Count: `COUNT(ID)` (exposed only in debug output as `rawLeadCount`)
- Different Month Leads: `COUNT(Diffrent Month)`
- Total Leads: `COUNT(ID) - COUNT(Diffrent Month)`
- Valid Leads: same value as Total Leads (`COUNT(ID) - COUNT(Diffrent Month)`)
- Total FTD: `COUNT(FTD MAKER)`
- CR: `COUNT(FTD MAKER) / Total Leads`
- CR Target: `AVG(CR TARGET)`
- CR Target Reach: `CR / AVG(CR TARGET)`
- Late FTD: `COUNT(LATE FTD +30 Day = 1)` (see fallback below)

Rows with empty `ID` are ignored. CR values return `0` when the denominator is
zero. `CR TARGET` is normalized when stored as `7%`, `0.07`, or `7`.

`Total Leads` and `Valid Leads` are the same number in this implementation:
both already exclude `Diffrent Month` rows. `rawLeadCount` (the unfiltered
`COUNT(ID)`) is only surfaced in debug output, not in production reports.

Lead and FTD date filters are intentionally separate:

- Lead calculations use `Lead Date` (column Y).
- FTD calculations use `FTD DATE` (column Q).
- FTD count does not require the lead to have been created inside the selected
  Lead Date range.
- `Diffrent Month` is excluded from Total Leads / Valid Leads (and therefore the
  CR denominator), but does not affect the FTD count.
- Late FTD uses `LATE FTD +30 Day` (column T) when present. If column T is not
  present, the fallback is `FTD DATE - Created > 30 days`.
- Production reports do not show debug values. Debug fields are only exposed in
  development/debug flows.

After each report, the bot shows optional breakdown buttons such as Top Agents,
Campaign Breakdown, Country Breakdown, Status Distribution, and Hourly Breakdown
depending on the selected report type.

Session state lives in memory in `lib/session.js`. When a persistent store is
configured (see below) sessions are mirrored to it and re-hydrated after a cold
start, without changing the Telegram webhook contract.

## Google Sheets defaults

- Service account:
  `matservice@mitservice.iam.gserviceaccount.com`
- Spreadsheet ID:
  `1cXyL60QniZevYOb06adN5FPHWN5tbYhiHX12yIa6kG4`
- Leads tab: `Leads`

Do not use the spreadsheet/file name as the sheet tab name. The spreadsheet file
can be named `May 26 Turkey Leads`, but the range must use the actual tab name:

```text
'Leads'!A:Y
```

The CRM table uses these columns:

```text
A Brand
B ID
C Created
D Department
E Status
F Country
G Campaign
H Sub-Campaign
I Placement
J First Call Agent
K Team Leader
L FTD
N FTD MAKER
O Office
P CR TARGET
Q FTD DATE
S LATE FTD Difrrence
T LATE FTD +30 Day
U Diffrent Month
V AGENT NAMES
W Agent ID
Y Lead Date
```

`Lead Date`, `FTD DATE`, and `Created` are parsed as `DD/MM/YYYY HH:MM:SS` when
time is present.

The service account must have access to the spreadsheet. Vercel also needs the
matching private key secret to authenticate as that account. Do not commit the
private key to the repository.

## Environment variables

Copy `.env.example` to `.env.local` for local development.

Required:

- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SPREADSHEET_ID`
- `ALLOWED_USERS` - comma-separated Telegram user IDs.
- `ADMIN_USERS` - comma-separated Telegram usernames or IDs with full bot
  access. Defaults to `@antoniotsd`, `@Cuervo0o0o`, and `@talhapervaiz97`.
- `ADMIN_CHAT_IDS` - optional comma-separated admin chat IDs for proactive
  access approval requests.
- `TELEGRAM_WEBHOOK_SECRET` - optional. When set, the webhook only accepts
  requests whose `X-Telegram-Bot-Api-Secret-Token` header matches this value.
  Use the same value as `secret_token` when registering the webhook.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN`) - optional persistent store, see above.
- `GOOGLE_SHEETS_CACHE_TTL_MS` - optional Sheets read cache window in ms
  (default `60000`).

Private key alternatives are also supported:

- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_PRIVATE_KEY_BASE64`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_CREDENTIALS_JSON`

`@antoniotsd`, `@Cuervo0o0o`, and `@talhapervaiz97` are configured as default
admins. Admin users are allowed to use the bot even if their numeric Telegram ID
is not listed in `ALLOWED_USERS`, and the permission layer exposes an `admin`
role for future configuration/admin features.

## Access approval flow

When an unauthorized user sends a message:

1. The bot creates a pending access request.
2. The user receives: `You are not authorized yet. An access request was sent to the admin.`
3. Admins receive an approval message with `Approve` and `Deny` buttons.
4. If an admin approves, the user is added to the in-memory approved user list
   and can use the bot.
5. If an admin denies, the user remains unauthorized.

Admin notifications require `TELEGRAM_BOT_TOKEN` because Telegram must send a
separate message to the admin chat. Add admin chat IDs to `ADMIN_CHAT_IDS`, or
have an admin open the bot first so their chat ID can be remembered. The approved
user list, remembered admin chats, and pending access requests are kept in
memory and, when a persistent store is configured, mirrored to it so they
survive serverless cold starts.

## Persistent store (optional)

Runtime state (sessions, approved users, remembered admin chats, and pending
access requests) defaults to in-memory storage, which resets on serverless cold
starts. To make it durable, configure an Upstash / Vercel KV REST endpoint:

- `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

When both URL and token are present the bot mirrors writes to the store and
re-hydrates memory at the start of each webhook request. When unset, behaviour is
unchanged (in-memory only). No extra npm dependency is required; the store uses
the REST API over `fetch`.

Google Sheets reads are cached in memory for a short window to avoid repeated API
calls during a single guided-report session. Tune it with
`GOOGLE_SHEETS_CACHE_TTL_MS` (milliseconds, default `60000`; set `0` to disable).

## Historical reporting via n8n + PostgreSQL (optional)

For a growing number of sheets (e.g. 4 new sheets per office every month) and
fast multi-month reports (6-month ranges across every office), the bot can read
from PostgreSQL instead of reading every Google Sheet live.

Architecture:

```
n8n (scheduled) → reads each Google Sheet → POST /api/ingest
   → normalize (same KPI columns) → upsert into PostgreSQL (lead_rows)
Telegram bot → reads PostgreSQL (indexed by office/period/country/lead_date/ftd_date)
            → runs the exact same KPI calculations → replies
Redis/KV → optional shared cache for query results
```

Key properties:

- **Calculation criteria never change.** Each sheet row is stored verbatim as
  JSONB; the bot runs the same calculations it uses for Google Sheets, so Total
  Leads / Valid Leads, FTD, CR, CR Target Reach and Late FTD stay identical.
- **n8n only does ETL.** It ships raw rows; it does not compute KPIs.
- **Idempotent sync.** Each sheet is a *source* (`sourceKey`); re-ingesting
  replaces that source's rows.
- **Fast date ranges.** `lead_date` and `ftd_date` are indexed and queried as a
  union, correctly covering cross-month FTDs.
- **Safe fallback.** When `DATABASE_URL` is unset the bot behaves exactly as
  before (reads Google Sheets directly).

Setup:

1. `psql "$DATABASE_URL" -f db/schema.sql`
2. Set `DATABASE_URL` and `INGEST_SECRET` (and optionally `KV_REST_API_URL` /
   `KV_REST_API_TOKEN` for Redis result caching).
3. Import `n8n/crm-sheets-sync.json` into n8n and follow `n8n/README.md`.

Relevant env vars:

- `DATABASE_URL` (or `POSTGRES_URL`) - enables the PostgreSQL path.
- `INGEST_SECRET` - required secret for the `/api/ingest` endpoint n8n calls.
- `DATA_CACHE_TTL_SECONDS` - cache window for DB-backed reads (default `60`).

Optional tab/range overrides:

- `GOOGLE_LEADS_TAB`, `GOOGLE_LEADS_RANGE`
- `GOOGLE_FTD_TAB`, `GOOGLE_FTD_RANGE`
- `GOOGLE_TRANSACTION_TAB`, `GOOGLE_TRANSACTION_RANGE`

## Local development

```bash
npm install
npm run dev
```

## Register Telegram webhook

Keep the BotFather token out of the repository. Use it only from a secure shell
or secret manager:

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export PUBLIC_APP_URL="https://your-next-app.vercel.app"

curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${PUBLIC_APP_URL}/api/telegram\"}"
```

If you set `TELEGRAM_WEBHOOK_SECRET`, register the same value so Telegram sends
it back on every request:

```bash
export TELEGRAM_WEBHOOK_SECRET="your-webhook-secret"

curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${PUBLIC_APP_URL}/api/telegram\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\"}"
```

Inbound webhook replies are returned directly to Telegram as webhook method
responses, so normal `/start` replies do not require `TELEGRAM_BOT_TOKEN` to be
present in Vercel at runtime. The token is still needed to register the webhook,
and is used for optional callback acknowledgements when configured.

## Troubleshooting no replies

1. Open `https://your-next-app.vercel.app/api/telegram`.
2. Confirm it returns JSON with `ok: true`.
3. Check `env.allowedUsersConfigured`. If it is `false`, set `ALLOWED_USERS`.
4. For normal users, check the Telegram user ID is included in `ALLOWED_USERS`.
   For admins, check the Telegram username or ID is included in `ADMIN_USERS`.
   For approval notifications, set `ADMIN_CHAT_IDS` or ask the admin to open the
   bot once.
5. Confirm the webhook is registered:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

The webhook URL must be exactly:

```text
https://your-next-app.vercel.app/api/telegram
```

## Troubleshooting report calculation failures

If the bot replies:

```text
Sorry, I could not calculate that report right now. Please try again later.
```

then the webhook is working, but report generation failed. Most failures happen
while reading Google Sheets.

Open this URL:

```text
https://your-next-app.vercel.app/api/telegram?check=sheets
```

or send `/debug` to the bot as an admin. The diagnostic checks whether the bot
can read the Leads tab and reports the safe error message.

`ok: true` on `/api/telegram` only means the endpoint is alive. It does not prove
that the service account can access the spreadsheet.

Common causes:

- The spreadsheet is not shared with the service account.
- The private key does not belong to `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
- Google Sheets API is not enabled for the service account project.
- `GOOGLE_LEADS_TAB` / `GOOGLE_LEADS_RANGE` does not match the actual tab.
- The service account email in Vercel is not the same account shared on the Sheet.

## Verification

```bash
npm test
npm run build
npm audit --audit-level=moderate
```