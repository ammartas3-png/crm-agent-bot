export default function Home() {
  return (
    <main style={{ fontFamily: "Arial, sans-serif", lineHeight: 1.5, padding: 32 }}>
      <h1>CRM Agent Bot</h1>
      <p>
        The Telegram reporting webhook is available at <code>/api/telegram</code>.
      </p>
      <p>
        Configure Telegram, Google Sheets, and allowed users with environment
        variables before using the bot.
      </p>
      <p>
        Reporting dashboard: <a href="/dashboard">/dashboard</a> (requires the
        access key when <code>INGEST_SECRET</code> is set).
      </p>
    </main>
  );
}
