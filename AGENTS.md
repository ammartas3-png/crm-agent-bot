# AGENTS.md

## Cursor Cloud specific instructions

### What this is
A single Next.js (App Router) service: a Telegram reporting bot that reads a
Google Sheet and replies with CRM metrics. The only runtime entrypoint is the
webhook route `app/api/telegram/route.js`; `app/page.js` is just a static
landing page (there is no interactive web UI to test).

### Run / build / test
Standard scripts in `package.json`:
- Dev server: `npm run dev` (Next.js on port 3000).
- Build: `npm run build`.
- Tests: `npm test` (Node's built-in test runner over `tests/*.test.js`).
There is no separate lint script; the TypeScript check runs as part of
`npm run build`.

### Exercising the bot without Telegram
You can drive the webhook directly with `curl` against the dev server. An admin
principal (default admins: `@antoniotsd`, `@Cuervo0o0o`, `@talhapervaiz97`) is
authorized without `ALLOWED_USERS` being set, e.g.:
```
curl -s -X POST http://localhost:3000/api/telegram -H "Content-Type: application/json" \
  -d '{"message":{"chat":{"id":1},"from":{"username":"antoniotsd"},"text":"hi"}}'
```
Replies are returned inline as Telegram webhook-method JSON, so no outbound
Telegram token is needed to see `/start`/menu responses.

### Google Sheets credentials are required for real reports
Any report that reads data needs Google service-account credentials
(`GOOGLE_PRIVATE_KEY` / `GOOGLE_SERVICE_ACCOUNT_*` variants) plus a spreadsheet
shared with that account. Without them, the report path fails fast with
"Google Sheets credentials are not configured" — that error means the request
pipeline is healthy and only the external secret is missing. Copy
`.env.example` to `.env.local` for local work; `.env.local` is gitignored.

### Performance / caching notes (non-obvious)
- Sheet reads are cached in-memory by `spreadsheetId + range` in
  `lib/googleSheets.js`. A single guided conversation triggers several reads
  (report -> date -> breakdown); the cache collapses them into one network call.
- TTL is controlled by `SHEETS_CACHE_TTL_MS` (default `30000`; set `0` to
  disable). Reports can therefore be up to TTL seconds stale — this is expected.
- The Google JWT auth client and Sheets client are memoized at module scope, so
  the OAuth token is reused across reads instead of re-minted each time.
- Passing a `sheetsClient` to `readSheetRows` (as tests do) bypasses the cache;
  pass `cache: false` to force a fresh read, or call `clearSheetsCache()` to
  reset cached rows. Cache state is per-process, so it resets on serverless cold
  starts and between dev-server restarts.
