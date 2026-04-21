// db.js — Railway-compatible MySQL Connection Pool
// Reads Railway plugin env vars (MYSQLHOST, MYSQLUSER, etc.)
// Falls back to DB_* vars for local development.
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// ── ENV RESOLUTION ────────────────────────────────────────────────
// Vercel / Supabase typically provides DATABASE_URL
const DB_HOST     = process.env.PGHOST     || process.env.DB_HOST     || 'localhost';
const DB_PORT     = parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10);
const DB_USER     = process.env.PGUSER     || process.env.DB_USER     || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || process.env.DB_PASSWORD || '';
const DB_NAME     = process.env.PGDATABASE || process.env.DB_NAME     || 'flatfinder';

// ── ENV VALIDATION ────────────────────────────────────────────────
if (!process.env.DATABASE_URL && (!DB_HOST || !DB_USER || !DB_NAME)) {
  console.error('[db.js] ❌ Missing required database environment variables.');
  console.error('[db.js]    Provide DATABASE_URL or set PGHOST / PGUSER / PGPASSWORD / PGDATABASE');
  process.exit(1);
}

// ── POOL CONFIG ───────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL;

const poolConfig = {
  max: IS_PROD ? 20 : 5,  // More connections in production
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

if (process.env.DATABASE_URL) {
  // Supabase / Vercel DATABASE_URL parsing
  const url = new URL(process.env.DATABASE_URL);
  poolConfig.host     = url.hostname;
  poolConfig.port     = parseInt(url.port, 10) || 5432;
  poolConfig.user     = decodeURIComponent(url.username);
  poolConfig.password = decodeURIComponent(url.password);
  poolConfig.database = url.pathname.replace(/^\//, '');
  // Supabase connections require SSL
  poolConfig.ssl      = { rejectUnauthorized: false };
} else {
  poolConfig.host     = DB_HOST;
  poolConfig.port     = DB_PORT;
  poolConfig.user     = DB_USER;
  poolConfig.password = DB_PASSWORD;
  poolConfig.database = DB_NAME;
}

// ── CREATE POOL ───────────────────────────────────────────────────
const pool = new Pool(poolConfig);

// ── CONNECTION VALIDATION ─────────────────────────────────────────
// Called once at server startup. Crashes early with a clear message if DB is unreachable.
export async function validateConnection() {
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    console.log('[db.js] ✅ PostgreSQL connected successfully.');
    console.log(`[db.js]    Host     : ${poolConfig.host}`);
    console.log(`[db.js]    Port     : ${poolConfig.port}`);
    console.log(`[db.js]    Database : ${poolConfig.database}`);
    console.log(`[db.js]    User     : ${poolConfig.user}`);
  } catch (err) {
    console.error('[db.js] ❌ PostgreSQL connection failed:', err.message);
    console.error('[db.js]    Code  :', err.code);
    console.error('[db.js]    Host  :', poolConfig.host);
    console.error('[db.js]    Port  :', poolConfig.port);
    process.exit(1);
  } finally {
    if (client) client.release();
  }
}

// ── QUERY HELPERS ─────────────────────────────────────────────────
export async function query(sql, params = []) {
  try {
    // ── MySQL -> PostgreSQL Query Translator ──
    // Automatically converts MySQL `?` placeholders into PostgreSQL `$1, $2`
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);

    const result = await pool.query(pgSql, params);
    return result.rows;
  } catch (err) {
    console.error('[db.js] Query error:', err.message);
    console.error('[db.js] SQL:', sql);
    throw err;
  }
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

export async function transaction(fn) {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db.js] Transaction rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export { pool };
export default pool;
