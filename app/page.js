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
        Report mapping screen: <a href="/report-map">/report-map</a>
      </p>
    </main>
  );
}
