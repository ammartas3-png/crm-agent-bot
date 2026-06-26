import pg from "pg";

// Lazily-created PostgreSQL pool. The bot only needs Postgres when historical /
// multi-sheet reporting is enabled; without DATABASE_URL it stays in the
// Google-Sheets-only mode and this module is never touched.

let pool = null;

export function databaseUrl(env = process.env) {
  return String(env.DATABASE_URL || env.POSTGRES_URL || "").trim();
}

export function isDatabaseEnabled(env = process.env) {
  return Boolean(databaseUrl(env));
}

function shouldUseSsl(env = process.env) {
  const url = databaseUrl(env);
  if (/sslmode=disable/i.test(url)) {
    return false;
  }
  if (String(env.PGSSL || env.DATABASE_SSL || "").toLowerCase() === "false") {
    return false;
  }
  // Managed Postgres (Supabase, Neon, RDS, ...) generally requires TLS.
  return /sslmode=require/i.test(url) || /\b(neon|supabase|render|rds|amazonaws|vercel)\b/i.test(url);
}

export function getPool(env = process.env) {
  if (!isDatabaseEnabled(env)) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: databaseUrl(env),
      max: Number(env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: Number(env.PG_CONNECT_TIMEOUT_MS) || 10_000,
      ...(shouldUseSsl(env) ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    pool.on("error", (error) => {
      console.error("Postgres pool error", error);
    });
  }
  return pool;
}

// All queries go through an injectable client so callers (and tests) can pass a
// fake. Defaults to the shared pool.
export async function query(text, params = [], client = null) {
  const runner = client || getPool();
  return runner.query(text, params);
}

export async function withTransaction(callback, env = process.env) {
  const client = await getPool(env).connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
