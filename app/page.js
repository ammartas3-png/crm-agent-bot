export default function Home() {
  return (
    <main style={{ fontFamily: "Arial, sans-serif", lineHeight: 1.5, padding: 32 }}>
      <h1>CRM Agent Bot</h1>
      <p>
        The Telegram reporting webhook is available at <code>/api/telegram</code>.
      </p>
      <p>
        Web dashboard is available at <a href="/dashboard">/dashboard</a>.
      </p>
      <p>
        Configure Telegram, Google Sheets, and allowed users with environment
        variables before using the bot.
      </p>
    </main>
  );
}
