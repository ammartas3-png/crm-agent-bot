"use client";

import { useState } from "react";
import styles from "./upload.module.css";

const CONTACT_ADMIN = "Erişiminiz yok. Lütfen admin ile iletişime geçin.";
const NOT_CONFIGURED =
  "Yükleme henüz yapılandırılmadı. Lütfen admin ile iletişime geçin.";
const WRONG_PASSWORD = "Yanlış parola. Lütfen admin ile iletişime geçin.";

const TAB_OPTIONS = [
  { value: "leads", label: "Leads" },
  { value: "ftd", label: "FTD" },
  { value: "infoAgents", label: "Info Agents" },
  { value: "transactions", label: "Transactions" },
];

export default function UploadPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [sourceKey, setSourceKey] = useState("");
  const [tabKey, setTabKey] = useState("leads");
  const [office, setOffice] = useState("");
  const [period, setPeriod] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [result, setResult] = useState(null);

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        setAuthed(true);
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (response.status === 503 || data.error === "not_configured") {
        setLoginError(NOT_CONFIGURED);
      } else if (response.status === 401 || data.error === "invalid_password") {
        setLoginError(WRONG_PASSWORD);
      } else {
        setLoginError(CONTACT_ADMIN);
      }
    } catch {
      setLoginError(CONTACT_ADMIN);
    } finally {
      setLoggingIn(false);
    }
  }

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
      form.append("password", password);
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
        setAuthed(false);
        setLoginError(WRONG_PASSWORD);
        return;
      }
      if (response.status === 503) {
        setUploadError(NOT_CONFIGURED);
        return;
      }
      setUploadError(data.error || "Yükleme başarısız oldu.");
    } catch (error) {
      setUploadError(String(error?.message || error));
    } finally {
      setUploading(false);
    }
  }

  if (!authed) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Tablo Yükleme</h1>
          <p className={styles.subtitle}>Devam etmek için parolanızı girin.</p>
          {loginError ? <p className={styles.error}>{loginError}</p> : null}
          <form onSubmit={handleLogin}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                Parola
              </label>
              <input
                id="password"
                className={styles.input}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
              <span className={styles.hint}>
                Parolanız yoksa lütfen admin ile iletişime geçin.
              </span>
            </div>
            <button className={styles.button} type="submit" disabled={loggingIn || !password}>
              {loggingIn ? "Kontrol ediliyor…" : "Giriş"}
            </button>
          </form>
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
          <span>Giriş yapıldı</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setAuthed(false);
              setPassword("");
              setResult(null);
              setUploadError("");
            }}
          >
            Çıkış
          </button>
        </div>
      </div>
    </main>
  );
}
