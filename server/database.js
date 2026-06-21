import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(currentDirectory, "data");
const databasePath =
  process.env.SQLITE_PATH || path.join(dataDirectory, "company-ai-tools.db");
const defaultUsers = [
  { username: "admin", role: "admin", department: "management" },
  { username: "content", role: "content", department: "content" },
  { username: "ops", role: "viewer", department: "ops" },
];

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.pragma("busy_timeout = 5000");
database.pragma("foreign_keys = ON");

initializeDatabase();

function initializeDatabase() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      department TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS ai_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'generation',
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      token_usage INTEGER NOT NULL DEFAULT 0,
      request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  migrateUsers();
  seedUsers();
  migrateAiLogs();
  removeLegacyPromptStorage();

  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at
      ON ai_logs(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ai_logs_user_created
      ON ai_logs(user_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_logs_user_request
      ON ai_logs(user_id, request_id)
      WHERE request_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_sessions_token
      ON sessions(token_hash);
  `);

  database
    .prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    .run();
}

function migrateUsers() {
  const columns = database.prepare("PRAGMA table_info(users)").all();

  if (!columns.some((column) => column.name === "role")) {
    database.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'",
    );
  }

  if (!columns.some((column) => column.name === "department")) {
    database.exec(
      "ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT 'general'",
    );
  }

  database
    .prepare(
      "UPDATE users SET role = 'admin', department = 'management' WHERE username = 'admin'",
    )
    .run();
  database
    .prepare(
      "UPDATE users SET role = 'content', department = 'content' WHERE username = 'content'",
    )
    .run();
  database
    .prepare(
      "UPDATE users SET role = 'viewer', department = 'ops' WHERE username = 'ops'",
    )
    .run();
}

function seedUsers() {
  const insertUser = database.prepare(`
    INSERT OR IGNORE INTO users
      (username, password_hash, password_salt, role, department)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const user of defaultUsers) {
    const { hash, salt } = hashPassword(user.username);
    insertUser.run(
      user.username,
      hash,
      salt,
      user.role,
      user.department,
    );
  }
}

function migrateAiLogs() {
  const columns = database.prepare("PRAGMA table_info(ai_logs)").all();

  if (!columns.some((column) => column.name === "user_id")) {
    database.exec(
      "ALTER TABLE ai_logs ADD COLUMN user_id INTEGER REFERENCES users(id)",
    );
  }

  if (!columns.some((column) => column.name === "request_id")) {
    database.exec("ALTER TABLE ai_logs ADD COLUMN request_id TEXT");
  }

  const admin = database
    .prepare("SELECT id FROM users WHERE username = 'admin'")
    .get();

  database
    .prepare("UPDATE ai_logs SET user_id = ? WHERE user_id IS NULL")
    .run(admin.id);
  database.prepare("UPDATE ai_logs SET type = 'generation'").run();
}

function removeLegacyPromptStorage() {
  const logColumns = database
    .prepare("PRAGMA table_info(ai_logs)")
    .all()
    .map((column) => column.name);

  if (!logColumns.includes("template_id")) {
    database.exec("DROP TABLE IF EXISTS prompt_templates");
    return;
  }

  database.pragma("foreign_keys = OFF");

  try {
    database.exec(`
      BEGIN;

      DROP INDEX IF EXISTS idx_ai_logs_user_request;
      DROP INDEX IF EXISTS idx_ai_logs_created_at;
      DROP INDEX IF EXISTS idx_ai_logs_type;
      DROP INDEX IF EXISTS idx_ai_logs_user_created;

      CREATE TABLE ai_logs_simplified (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'generation',
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        token_usage INTEGER NOT NULL DEFAULT 0,
        request_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO ai_logs_simplified
        (id, user_id, type, input, output, token_usage, request_id, created_at)
      SELECT
        id, user_id, 'generation', input, output, token_usage, request_id, created_at
      FROM ai_logs;

      DROP TABLE ai_logs;
      ALTER TABLE ai_logs_simplified RENAME TO ai_logs;
      DROP TABLE IF EXISTS prompt_templates;

      COMMIT;
    `);
  } catch (error) {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }

    throw error;
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString("hex"),
  };
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function authenticateUser(username, password) {
  if (!username || !password) {
    return null;
  }

  const user = database
    .prepare(
      `SELECT id, username, password_hash, password_salt, role, department
       FROM users WHERE username = ?`,
    )
    .get(String(username).trim());

  if (!user) {
    return null;
  }

  const candidate = Buffer.from(
    hashPassword(String(password), user.password_salt).hash,
    "hex",
  );
  const expected = Buffer.from(user.password_hash, "hex");

  if (
    candidate.length !== expected.length ||
    !crypto.timingSafeEqual(candidate, expected)
  ) {
    return null;
  }

  return normalizeUser(user);
}

export function createSession(userId, maxAgeSeconds = 7 * 24 * 60 * 60) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  database
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .run(hashSessionToken(token), userId, expiresAt);

  return { token, maxAgeSeconds };
}

export function getUserBySessionToken(token) {
  if (!token) {
    return null;
  }

  const user = database
    .prepare(`
      SELECT users.id, users.username, users.role, users.department
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > datetime('now')
    `)
    .get(hashSessionToken(token));

  return user ? normalizeUser(user) : null;
}

export function deleteSession(token) {
  if (token) {
    database
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashSessionToken(token));
  }
}

export function addAiLog({
  userId,
  input,
  output,
  tokenUsage,
  requestId = null,
}) {
  const result = database
    .prepare(`
      INSERT INTO ai_logs
        (user_id, type, input, output, token_usage, request_id)
      VALUES
        (@userId, 'generation', @input, @output, @tokenUsage, @requestId)
    `)
    .run({
      userId,
      input: JSON.stringify(input),
      output:
        typeof output === "string" ? output : JSON.stringify(output, null, 2),
      tokenUsage: Math.max(Number(tokenUsage) || 0, 0),
      requestId: requestId || null,
    });

  return Number(result.lastInsertRowid);
}

export function recordGeneration(payload) {
  return addAiLog(payload);
}

export function getGenerationByRequestId({ userId, requestId }) {
  if (!requestId) {
    return null;
  }

  const row = database
    .prepare(`
      SELECT id, type, input, output, token_usage, request_id, created_at
      FROM ai_logs
      WHERE user_id = ? AND request_id = ?
    `)
    .get(userId, requestId);

  return row
    ? {
        ...row,
        input: parseStoredValue(row.input),
        output: parseStoredValue(row.output),
      }
    : null;
}

export function listAiLogs({ userId, limit, allUsers = false } = {}) {
  const safeLimit = limit
    ? Math.min(Math.max(Number(limit) || 20, 1), 100)
    : null;
  const parameters = [];
  const whereClause = allUsers ? "" : "WHERE ai_logs.user_id = ?";

  if (!allUsers) {
    parameters.push(userId);
  }

  if (safeLimit) {
    parameters.push(safeLimit);
  }

  const rows = database
    .prepare(`
      SELECT ai_logs.id, ai_logs.user_id, users.username,
             ai_logs.type, ai_logs.input, ai_logs.output,
             ai_logs.token_usage, ai_logs.request_id, ai_logs.created_at
      FROM ai_logs
      JOIN users ON users.id = ai_logs.user_id
      ${whereClause}
      ORDER BY ai_logs.created_at DESC, ai_logs.id DESC
      ${safeLimit ? "LIMIT ?" : ""}
    `)
    .all(...parameters);

  return rows.map((row) => ({
    ...row,
    input: parseStoredValue(row.input),
  }));
}

export function getUsageStats(userId) {
  const counts = database
    .prepare(`
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(token_usage), 0) AS total_tokens,
        SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END) AS today_count,
        SUM(CASE WHEN date(created_at) >= date('now', 'localtime', '-' || ((strftime('%w', 'now', 'localtime') + 6) % 7) || ' days') THEN 1 ELSE 0 END) AS week_count
      FROM ai_logs
      WHERE user_id = ?
    `)
    .get(userId);

  return {
    today_count: Number(counts.today_count) || 0,
    week_count: Number(counts.week_count) || 0,
    total_count: Number(counts.total_count) || 0,
    total_tokens: Number(counts.total_tokens) || 0,
    daily_limit: 50,
  };
}

export function getPersonalDashboard(userId) {
  return {
    stats: getUsageStats(userId),
    recent_history: listAiLogs({ userId, limit: 10 }),
  };
}

export function getAdminDashboard() {
  const summary = database
    .prepare(`
      SELECT
        SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END) AS today_calls,
        SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN token_usage ELSE 0 END) AS today_tokens,
        COUNT(*) AS total_calls,
        COALESCE(SUM(token_usage), 0) AS total_tokens
      FROM ai_logs
    `)
    .get();
  const userRanking = database
    .prepare(`
      SELECT users.id, users.username, users.department,
             COUNT(ai_logs.id) AS call_count,
             COALESCE(SUM(ai_logs.token_usage), 0) AS token_count
      FROM users
      LEFT JOIN ai_logs ON ai_logs.user_id = users.id
      GROUP BY users.id
      ORDER BY call_count DESC, token_count DESC
    `)
    .all();
  const tokenTrend = database
    .prepare(`
      WITH RECURSIVE dates(day) AS (
        SELECT date('now', 'localtime', '-6 days')
        UNION ALL
        SELECT date(day, '+1 day') FROM dates
        WHERE day < date('now', 'localtime')
      )
      SELECT dates.day,
             COUNT(ai_logs.id) AS calls,
             COALESCE(SUM(ai_logs.token_usage), 0) AS tokens
      FROM dates
      LEFT JOIN ai_logs ON date(ai_logs.created_at) = dates.day
      GROUP BY dates.day
      ORDER BY dates.day
    `)
    .all();

  return {
    summary: {
      today_calls: Number(summary.today_calls) || 0,
      today_tokens: Number(summary.today_tokens) || 0,
      total_calls: Number(summary.total_calls) || 0,
      total_tokens: Number(summary.total_tokens) || 0,
    },
    user_ranking: userRanking,
    token_trend: tokenTrend,
  };
}

function normalizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role:
      user.role === "admin"
        ? "admin"
        : user.role === "content" || user.username === "content"
          ? "content"
          : "viewer",
    department: user.department,
  };
}

function parseStoredValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function closeDatabase() {
  database.close();
}
