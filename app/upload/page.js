import styles from "./upload.module.css";

export const metadata = {
  title: "Bakımda",
};

export default function UploadPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Sayfa kullanım dışı</h1>
        <p className={styles.subtitle}>
          Bu sayfa şu anda bakımda. Lütfen daha sonra tekrar deneyin.
        </p>
      </div>
    </main>
  );
}
