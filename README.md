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

## Structure

```text
app/api/telegram/route.js
lib/telegram.js
lib/googleSheets.js
lib/queryRouter.js
lib/calculations.js
lib/permissions.js
config/sheetsConfig.js
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

- Total Leads: `COUNT(ID)`
- Different Month Leads: `COUNT(Diffrent Month)`
- Valid Leads: `COUNT(ID) - COUNT(Diffrent Month)`
- Total FTD: `COUNT(FTD MAKER)`
- CR: `COUNT(FTD MAKER) / Valid Leads`
- CR Target: `AVG(CR TARGET)`
- CR Target Reach: `CR / AVG(CR TARGET)`
- Late FTD: `COUNT(LATE FTD Difrrence)`

Rows with empty `ID` are ignored. CR values return `0` when the denominator is
zero. `CR TARGET` is normalized when stored as `7%`, `0.07`, or `7`.

Lead and FTD date filters are intentionally separate:

- Lead calculations use `Lead Date` (column Y).
- FTD calculations use `FTD DATE` (column Q).
- FTD count does not require the lead to have been created inside the selected
  Lead Date range.
- `Diffrent Month` affects only Valid Leads, not FTD count.

After each report, the bot shows optional breakdown buttons such as Top Agents,
Campaign Breakdown, Country Breakdown, Status Distribution, and Hourly Breakdown
depending on the selected report type.

Session state is currently stored in memory in `lib/session.js`; this can be
moved to a database later without changing the Telegram webhook contract.

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
have an admin open the bot first so their chat ID can be remembered in memory.
The approved user list is also in memory for now and will reset on serverless
cold starts; move it to a database when persistent access control is needed.

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