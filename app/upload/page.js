"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./upload.module.css";

const CONTACT_ADMIN = "Lütfen admin ile iletişime geçin.";

const TAB_OPTIONS = [
  { value: "leads", label: "Leads" },
  { value: "ftd", label: "FTD" },
  { value: "infoAgents", label: "Info Agents" },
  { value: "transactions", label: "Transactions" },
];

// Reuses the exact same Telegram login widget as the dashboard so access is
// shared (same session cookie + admin approval).
function TelegramLoginWidget({ botUsername, onAuth }) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!botUsername || !containerRef.current) {
      return undefined;
    }
    const container = containerRef.current;
    container.innerHTML = "";
    globalThis.crmUploadTelegramAuth = async (user) => {
      await onAuth(user);
    };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "crmUploadTelegramAuth(user)");
    script.setAttribute("data-lang", "en");
    container.appendChild(script);
    return () => {
      delete globalThis.crmUploadTelegramAuth;
      container.innerHTML = "";
    };
  }, [botUsername, onAuth]);
  return <div ref={containerRef} />;
}

export default function UploadPage() {
  const [session, setSession] = useState({
    loading: true,
    authenticated: false,
    authorized: false,
    auth: { enabled: false, botUsername: "" },
    user: null,
    error: "",
  });

  const [sourceKey, setSourceKey] = useState("");
  const [tabKey, setTabKey] = useState("leads");
  const [office, setOffice] = useState("");
  const [period, setPeriod] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [result, setResult] = useState(null);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/session", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      setSession({
        loading: false,
        authenticated: Boolean(payload.authenticated),
        authorized: Boolean(payload.authorized),
        auth: {
          enabled: Boolean(payload.auth?.enabled),
          botUsername: payload.auth?.botUsername || "",
        },
        user: payload.user || null,
        error: "",
      });
    } catch {
      setSession((prev) => ({ ...prev, loading: false, error: "Oturum bilgisi alınamadı." }));
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const handleTelegramAuth = useCallback(
    async (user) => {
      setSession((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const response = await fetch("/api/dashboard/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user || {}),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          throw new Error(payload?.error || "Telegram girişi başarısız.");
        }
        await fetchSession();
      } catch (error) {
        setSession((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || "Telegram girişi başarısız.",
        }));
      }
    },
    [fetchSession],
  );

  const handleLogout = useCallback(async () => {
    await fetch("/api/dashboard/auth/logout", { method: "POST" }).catch(() => {});
    setResult(null);
    setUploadError("");
    await fetchSession();
  }, [fetchSession]);

  async function handleUpload(event) {
    event.preventDefault();
    setUploadError("");
    setResult(null);
    if (!file) {
      setUploadError("Lütfen bir dosya seçin.");
      return;
    }
    if (!sourceKey.trim()) {
      setUploadError("Lütfen bir kaynak anahtarı (source key) girin.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sourceKey", sourceKey.trim());
      form.append("tabKey", tabKey);
      if (office.trim()) form.append("office", office.trim());
      if (period.trim()) form.append("period", period.trim());
      if (category.trim()) form.append("category", category.trim());

      const response = await fetch("/api/upload", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) {
        setResult(data);
        return;
      }
      if (response.status === 401) {
        await fetchSession();
        return;
      }
      if (response.status === 403) {
        setUploadError(`Yetkiniz yok. ${CONTACT_ADMIN}`);
        await fetchSession();
        return;
      }
      setUploadError(data.error || "Yükleme başarısız oldu.");
    } catch (error) {
      setUploadError(String(error?.message || error));
    } finally {
      setUploading(false);
    }
  }

  if (session.loading) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <p>Yükleniyor…</p>
        </div>
      </main>
    );
  }

  if (!session.authenticated) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Tablo Yükleme</h1>
          <p className={styles.subtitle}>
            Telegram hesabınızla giriş yapın. Erişim izinleri Telegram botu ile paylaşılır.
          </p>
          {session.auth.enabled ? (
            <TelegramLoginWidget botUsername={session.auth.botUsername} onAuth={handleTelegramAuth} />
          ) : (
            <p className={styles.error}>
              Telegram giriş bileşeni kullanılamıyor. TELEGRAM_BOT_TOKEN ayarını kontrol edin.
            </p>
          )}
          <p className={styles.hint}>Erişiminiz yoksa {CONTACT_ADMIN}</p>
          {session.error ? <p className={styles.error}>{session.error}</p> : null}
        </div>
      </main>
    );
  }

  if (!session.authorized) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Tablo Yükleme</h1>
          <p className={styles.error}>
            Telegram hesabınız giriş yaptı ancak henüz yetkili değil. Onay için {CONTACT_ADMIN}
          </p>
          <div className={styles.footer}>
            <span>
              {session.user?.username ? `@${session.user.username}` : session.user?.id}
            </span>
            <button type="button" className={styles.linkButton} onClick={handleLogout}>
              Çıkış
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Tablo Yükleme</h1>
        <p className={styles.subtitle}>
          Bir Excel (.xlsx / .xls) veya CSV tablosu yükleyin. İlk satır başlık olarak kullanılır.
        </p>
        {uploadError ? <p className={styles.error}>{uploadError}</p> : null}
        {result ? (
          <div className={styles.success}>
            <strong>Yükleme tamamlandı.</strong>
            <div className={styles.resultBox}>{JSON.stringify(result, null, 2)}</div>
          </div>
        ) : null}
        <form onSubmit={handleUpload}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="file">
              Dosya
            </label>
            <input
              id="file"
              className={styles.input}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="sourceKey">
                Kaynak anahtarı (source key)
              </label>
              <input
                id="sourceKey"
                className={styles.input}
                type="text"
                value={sourceKey}
                onChange={(event) => setSourceKey(event.target.value)}
                placeholder="ör. turkey-2026-09-leads"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tabKey">
                Tablo tipi
              </label>
              <select
                id="tabKey"
                className={styles.select}
                value={tabKey}
                onChange={(event) => setTabKey(event.target.value)}
              >
                {TAB_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="office">
                Ofis (opsiyonel)
              </label>
              <input
                id="office"
                className={styles.input}
                type="text"
                value={office}
                onChange={(event) => setOffice(event.target.value)}
                placeholder="ör. Turkey"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="period">
                Dönem (opsiyonel)
              </label>
              <input
                id="period"
                className={styles.input}
                type="text"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                placeholder="YYYY-MM"
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="category">
              Kategori (opsiyonel)
            </label>
            <input
              id="category"
              className={styles.input}
              type="text"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="leads / ftd / roster / info"
            />
            <span className={styles.hint}>Boş bırakılırsa tablo tipine göre belirlenir.</span>
          </div>
          <button className={styles.button} type="submit" disabled={uploading}>
            {uploading ? "Yükleniyor…" : "Yükle"}
          </button>
        </form>
        <div className={styles.footer}>
          <span>
            Giriş: {session.user?.username ? `@${session.user.username}` : session.user?.id}
          </span>
          <button type="button" className={styles.linkButton} onClick={handleLogout}>
            Çıkış
          </button>
        </div>
      </div>
    </main>
  );
}
