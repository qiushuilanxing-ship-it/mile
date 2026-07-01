import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import dotenv from "dotenv";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(currentDirectory, ".env") });
const dataDirectory = path.join(currentDirectory, "data");
const databasePath =
  process.env.SQLITE_PATH || path.join(currentDirectory, "data.sqlite");
const unsafeDefaultUsers = ["admin", "content", "ops"];
const forbiddenPasswords = new Set([
  "123456",
  "password",
  "admin",
  "admin123",
  "12345678",
  "qwerty123",
]);

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
      name TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      default_range_json TEXT NOT NULL DEFAULT '{}',
      account_tasks_json TEXT NOT NULL DEFAULT '[]',
      accounts_json TEXT NOT NULL DEFAULT '[]',
      videos_json TEXT NOT NULL DEFAULT '[]',
      audit_results_json TEXT NOT NULL DEFAULT '{}',
      manual_reviews_json TEXT NOT NULL DEFAULT '{}',
      feedbacks_json TEXT NOT NULL DEFAULT '{}',
      summary_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_rules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      risk_level TEXT,
      decision TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      positive_examples_json TEXT NOT NULL DEFAULT '[]',
      negative_examples_json TEXT NOT NULL DEFAULT '[]',
      suggested_action TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      source_sample_id TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrateUsers();
  configureInitialAdmin();
  disableUnsafeDefaultUsers();
  migrateAiLogs();
  migrateAuditRuns();
  migrateAuditRules();
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

    CREATE INDEX IF NOT EXISTS idx_audit_runs_user_updated
      ON audit_runs(created_by, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_rules_updated
      ON audit_rules(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_rules_enabled_updated
      ON audit_rules(enabled, updated_at DESC);
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

  if (!columns.some((column) => column.name === "name")) {
    database.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
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

function configureInitialAdmin() {
  const adminPassword = String(process.env.ADMIN_PASSWORD ?? "");
  const adminUsername = String(process.env.ADMIN_USERNAME || "admin").trim();
  const adminName = String(process.env.ADMIN_NAME || adminUsername).trim();
  const userCount = database.prepare("SELECT COUNT(*) AS count FROM users").get();

  if (!adminPassword) {
    if (Number(userCount.count) === 0) {
      console.warn(
        "[auth] ADMIN_PASSWORD is not configured. Initial admin creation skipped.",
      );
    }

    return;
  }

  if (!isStrongInitialPassword(adminPassword, adminUsername)) {
    console.warn(
      "[auth] ADMIN_PASSWORD is too weak. Initial admin creation skipped.",
    );
    return;
  }

  upsertUser({
    username: adminUsername,
    password: adminPassword,
    role: "admin",
    department: "management",
    name: adminName,
  });

  const action = Number(userCount.count) === 0 ? "created" : "synced";
  console.warn(`[auth] Initial admin user ${action} from ADMIN_* env: ${adminUsername}`);
}

function disableUnsafeDefaultUsers() {
  for (const username of unsafeDefaultUsers) {
    const user = database
      .prepare("SELECT username, password_hash, password_salt FROM users WHERE username = ?")
      .get(username);

    if (!user || !passwordMatches(user, username)) {
      continue;
    }

    const randomPassword = crypto.randomBytes(48).toString("base64url");
    const { hash, salt } = hashPassword(randomPassword);
    database
      .prepare(
        "UPDATE users SET password_hash = ?, password_salt = ? WHERE username = ?",
      )
      .run(hash, salt, username);
    console.warn(`[auth] Disabled unsafe default password for user: ${username}`);
  }
}

function isStrongInitialPassword(password, username) {
  const value = String(password);
  const normalized = value.toLowerCase();

  return (
    value.length >= 8 &&
    normalized !== String(username).toLowerCase() &&
    !forbiddenPasswords.has(normalized)
  );
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

  const fallbackUser = database
    .prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1")
    .get();

  if (fallbackUser) {
    database
      .prepare("UPDATE ai_logs SET user_id = ? WHERE user_id IS NULL")
      .run(fallbackUser.id);
  }

  database.prepare("UPDATE ai_logs SET type = 'generation'").run();
}

function migrateAuditRuns() {
  const columns = database.prepare("PRAGMA table_info(audit_runs)").all();
  const columnNames = columns.map((column) => column.name);

  if (!columnNames.includes("created_by")) {
    database.exec("ALTER TABLE audit_runs ADD COLUMN created_by TEXT");
  }

  if (!columnNames.includes("created_by_name")) {
    database.exec(
      "ALTER TABLE audit_runs ADD COLUMN created_by_name TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!columnNames.includes("manual_reviews_json")) {
    database.exec(
      "ALTER TABLE audit_runs ADD COLUMN manual_reviews_json TEXT NOT NULL DEFAULT '{}'",
    );
  }

  if (!columnNames.includes("feedbacks_json")) {
    database.exec(
      "ALTER TABLE audit_runs ADD COLUMN feedbacks_json TEXT NOT NULL DEFAULT '{}'",
    );
  }
}

function migrateAuditRules() {
  const columns = database.prepare("PRAGMA table_info(audit_rules)").all();
  const columnNames = columns.map((column) => column.name);
  const requiredColumns = [
    ["category", "TEXT"],
    ["risk_level", "TEXT"],
    ["decision", "TEXT"],
    ["keywords_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["description", "TEXT"],
    ["positive_examples_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["negative_examples_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["suggested_action", "TEXT"],
    ["enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["source_sample_id", "TEXT"],
    ["created_by", "TEXT"],
    ["created_by_name", "TEXT"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [name, definition] of requiredColumns) {
    if (!columnNames.includes(name)) {
      database.exec(`ALTER TABLE audit_rules ADD COLUMN ${name} ${definition}`);
    }
  }
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

function passwordMatches(user, password) {
  const candidate = Buffer.from(
    hashPassword(String(password), user.password_salt).hash,
    "hex",
  );
  const expected = Buffer.from(user.password_hash, "hex");

  return (
    candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected)
  );
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
      `SELECT id, username, name, password_hash, password_salt, role, department
       FROM users WHERE username = ?`,
    )
    .get(String(username).trim());

  if (!user) {
    return null;
  }

  if (!passwordMatches(user, password)) {
    return null;
  }

  return normalizeUser(user);
}

export function upsertUser({
  username,
  password,
  role = "viewer",
  department = "general",
  name: _name = "",
}) {
  const cleanUsername = String(username ?? "").trim();

  if (!cleanUsername || !password) {
    throw new Error("username and password are required");
  }

  const normalizedRole =
    role === "admin" ? "admin" : role === "content" ? "content" : "viewer";
  const { hash, salt } = hashPassword(String(password));

  database
    .prepare(`
      INSERT INTO users
        (username, password_hash, password_salt, role, department, name)
      VALUES
        (@username, @password_hash, @password_salt, @role, @department, @name)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        role = excluded.role,
        department = excluded.department,
        name = excluded.name
    `)
    .run({
      username: cleanUsername,
      password_hash: hash,
      password_salt: salt,
      role: normalizedRole,
      department: String(department || "general"),
      name: cleanText(_name),
    });

  return authenticateUser(cleanUsername, password);
}

export function listUsers() {
  return database
    .prepare(`
      SELECT users.id, users.username, users.name, users.role, users.department,
             users.created_at,
             COUNT(ai_logs.id) AS call_count,
             COALESCE(SUM(ai_logs.token_usage), 0) AS token_count
      FROM users
      LEFT JOIN ai_logs ON ai_logs.user_id = users.id
      GROUP BY users.id
      ORDER BY users.created_at DESC, users.id DESC
    `)
    .all()
    .map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name || user.username,
      role: normalizeUser(user).role,
      department: user.department,
      created_at: user.created_at,
      call_count: Number(user.call_count) || 0,
      token_count: Number(user.token_count) || 0,
    }));
}

export function updateUserPassword({ id, password }) {
  const userId = Number(id);

  if (!Number.isInteger(userId) || userId <= 0 || !password) {
    throw new Error("valid user id and password are required");
  }

  const existing = database
    .prepare("SELECT id, username FROM users WHERE id = ?")
    .get(userId);

  if (!existing) {
    return null;
  }

  const { hash, salt } = hashPassword(String(password));
  database
    .prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
    )
    .run(hash, salt, userId);

  return listUsers().find((user) => Number(user.id) === userId) || null;
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
      SELECT users.id, users.username, users.name, users.role, users.department
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

export function upsertAuditRun({
  id,
  title,
  createdBy,
  createdByName = "",
  canUpdateAll = false,
  defaultRange = {},
  accountTasks = [],
  accounts = [],
  videos = [],
  auditResults = {},
  manualReviews = {},
  feedbacks = {},
  summary = {},
  status = "pending",
  note = "",
}) {
  const runId = id || crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = database
    .prepare("SELECT id, created_at, created_by FROM audit_runs WHERE id = ?")
    .get(runId);

  if (
    existing &&
    !canUpdateAll &&
    cleanText(existing.created_by) !== String(createdBy)
  ) {
    const error = new Error("无权限修改该质检记录");
    error.code = "AUDIT_RUN_FORBIDDEN";
    throw error;
  }

  const record = {
    id: runId,
    title: cleanText(title) || defaultAuditRunTitle(now),
    created_at: existing?.created_at || now,
    updated_at: now,
    created_by: existing?.created_by || String(createdBy),
    created_by_name:
      existing?.created_by && canUpdateAll
        ? undefined
        : cleanText(createdByName) || "未知创建人",
    default_range_json: stringifyJson(defaultRange, {}),
    account_tasks_json: stringifyJson(accountTasks, []),
    accounts_json: stringifyJson(accounts, []),
    videos_json: stringifyJson(videos, []),
    audit_results_json: stringifyJson(auditResults, {}),
    manual_reviews_json: stringifyJson(manualReviews, {}),
    feedbacks_json: stringifyJson(feedbacks, {}),
    summary_json: stringifyJson(summary, {}),
    status: normalizeAuditRunStatus(status),
    note: cleanText(note),
  };

  if (existing) {
    const updateRecord = {
      ...record,
      created_by_name:
        record.created_by_name === undefined
          ? database
              .prepare("SELECT created_by_name FROM audit_runs WHERE id = ?")
              .get(runId)?.created_by_name || ""
          : record.created_by_name,
    };
    database
      .prepare(`
        UPDATE audit_runs
        SET title = @title,
            updated_at = @updated_at,
            created_by_name = @created_by_name,
            default_range_json = @default_range_json,
            account_tasks_json = @account_tasks_json,
            accounts_json = @accounts_json,
            videos_json = @videos_json,
            audit_results_json = @audit_results_json,
            manual_reviews_json = @manual_reviews_json,
            feedbacks_json = @feedbacks_json,
            summary_json = @summary_json,
            status = @status,
            note = @note
        WHERE id = @id
      `)
      .run(updateRecord);
  } else {
    database
      .prepare(`
        INSERT INTO audit_runs
          (id, title, created_at, updated_at, created_by, created_by_name, default_range_json,
           account_tasks_json, accounts_json, videos_json, audit_results_json, manual_reviews_json, feedbacks_json,
           summary_json, status, note)
        VALUES
          (@id, @title, @created_at, @updated_at, @created_by, @created_by_name, @default_range_json,
           @account_tasks_json, @accounts_json, @videos_json, @audit_results_json, @manual_reviews_json, @feedbacks_json,
           @summary_json, @status, @note)
      `)
      .run(record);
  }

  return getAuditRun({ id: runId, createdBy, canReadAll: true });
}

export function getLatestAuditRun({ createdBy, allUsers = false } = {}) {
  const whereClause = allUsers
    ? ""
    : "WHERE created_by = ?";
  const parameters = allUsers ? [] : [String(createdBy)];
  const row = database
    .prepare(`
      SELECT *
      FROM audit_runs
      ${whereClause}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `)
    .get(...parameters);

  return row ? normalizeAuditRun(row, true) : null;
}

export function listAuditRuns({ createdBy, limit = 20, allUsers = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const whereClause = allUsers
    ? ""
    : "WHERE created_by = ?";
  const parameters = allUsers
    ? [safeLimit]
    : [String(createdBy), safeLimit];
  const rows = database
    .prepare(`
      SELECT id, title, created_at, updated_at, created_by, created_by_name,
             accounts_json, videos_json, summary_json, status, note
      FROM audit_runs
      ${whereClause}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `)
    .all(...parameters);

  return rows.map((row) => normalizeAuditRun(row, false));
}

export function getAuditRun({ id, createdBy, canReadAll = false }) {
  const row = database
    .prepare("SELECT * FROM audit_runs WHERE id = ?")
    .get(String(id));

  if (!row) return null;

  if (!canReadAll && cleanText(row.created_by) !== String(createdBy)) {
    const error = new Error("无权限查看该质检记录");
    error.code = "AUDIT_RUN_FORBIDDEN";
    throw error;
  }

  return normalizeAuditRun(row, true);
}

export function deleteAuditRun({ id, createdBy, canDeleteAll = false }) {
  const row = database
    .prepare("SELECT id, created_by FROM audit_runs WHERE id = ?")
    .get(String(id));

  if (!row) return false;

  if (!canDeleteAll && cleanText(row.created_by) !== String(createdBy)) {
    const error = new Error("无权限删除该质检记录");
    error.code = "AUDIT_RUN_FORBIDDEN";
    throw error;
  }

  const result = database
    .prepare("DELETE FROM audit_runs WHERE id = ?")
    .run(String(id));

  return result.changes > 0;
}

export function listFeedbackSamples({
  createdBy,
  allUsers = false,
  type = "all",
  limit = 100,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const allowedTypes = new Set([
    "correct",
    "false_positive",
    "false_negative",
    "rule_gap",
    "uncertain",
  ]);
  const filterType = allowedTypes.has(type) ? type : "all";
  const whereClause = allUsers ? "" : "WHERE created_by = ?";
  const parameters = allUsers ? [] : [String(createdBy)];
  const rows = database
    .prepare(`
      SELECT id, title, created_at, updated_at, created_by, created_by_name,
             videos_json, audit_results_json, manual_reviews_json, feedbacks_json
      FROM audit_runs
      ${whereClause}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 500
    `)
    .all(...parameters);
  const samples = [];
  const summary = {
    total: 0,
    correct: 0,
    false_positive: 0,
    false_negative: 0,
    rule_gap: 0,
    uncertain: 0,
  };

  for (const row of rows) {
    const videos = parseJsonValue(row.videos_json, []);
    const auditResults = parseJsonValue(row.audit_results_json, {});
    const manualReviews = parseJsonValue(row.manual_reviews_json, {});
    const feedbacks = parseJsonValue(row.feedbacks_json, {});
    const videoMap = new Map(
      Array.isArray(videos)
        ? videos.map((video) => [video.video_id, video])
        : [],
    );

    for (const [videoId, feedback] of Object.entries(feedbacks || {})) {
      if (!feedback?.type) continue;
      if (Object.hasOwn(summary, feedback.type)) {
        summary[feedback.type] += 1;
      }
      summary.total += 1;

      if (filterType !== "all" && feedback.type !== filterType) continue;

      const video = videoMap.get(videoId) || {};
      const aiResult = auditResults?.[videoId] || {};
      const manualReview = manualReviews?.[videoId] || {};
      samples.push({
        run_id: row.id,
        run_title: row.title,
        video_id: videoId,
        video_url: video.page_url || "",
        cover_url: video.cover_url || "",
        desc: video.desc || "",
        author_name: video.author_name || "",
        account_name: video.frontend_name || video.author_name || "",
        erp_name: video.erp_name || "",
        douyin_id: video.douyin_id || "",
        sec_uid: video.secUid || "",
        create_time: video.create_time || "",
        ai_result: aiResult.audit_result || "",
        ai_risk_level: aiResult.risk_level || "",
        ai_problem:
          Array.isArray(aiResult.main_risks) && aiResult.main_risks.length > 0
            ? aiResult.main_risks.join("；")
            : aiResult.problem_description || "",
        manual_status: manualReview.status || "",
        manual_note: manualReview.note || "",
        feedback_type: feedback.type || "",
        feedback_note: feedback.note || "",
        suggested_rule: feedback.suggested_rule || "",
        feedback_by: feedback.feedback_by || "",
        feedback_by_name: feedback.feedback_by_name || "",
        feedback_at: feedback.feedback_at || "",
        created_by: cleanText(row.created_by),
        created_by_name: cleanText(row.created_by_name) || "未知创建人",
      });

      if (samples.length >= safeLimit) return { samples, summary };
    }
  }

  return { samples, summary };
}

export function listAuditRules({
  enabled = "1",
  category = "",
  keyword = "",
  limit = 100,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const where = [];
  const params = {};

  if (enabled !== "all") {
    where.push("enabled = @enabled");
    params.enabled = String(enabled) === "0" ? 0 : 1;
  }

  if (cleanText(category)) {
    where.push("category = @category");
    params.category = cleanText(category);
  }

  if (cleanText(keyword)) {
    where.push(`(
      title LIKE @keyword OR
      category LIKE @keyword OR
      description LIKE @keyword OR
      keywords_json LIKE @keyword OR
      suggested_action LIKE @keyword
    )`);
    params.keyword = `%${cleanText(keyword)}%`;
  }

  params.limit = safeLimit;

  const rows = database
    .prepare(`
      SELECT *
      FROM audit_rules
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY enabled DESC, updated_at DESC
      LIMIT @limit
    `)
    .all(params);

  return rows.map(normalizeAuditRule);
}

export function listEnabledAuditRules({ limit = 200 } = {}) {
  return listAuditRules({ enabled: "1", limit });
}

export function getAuditRule(id) {
  const row = database
    .prepare("SELECT * FROM audit_rules WHERE id = ?")
    .get(String(id ?? ""));

  return row ? normalizeAuditRule(row) : null;
}

export function createAuditRule(payload, user) {
  const now = new Date().toISOString();
  const rule = normalizeAuditRuleInput(payload);

  if (!rule.title) {
    const error = new Error("请填写规则名称");
    error.code = "AUDIT_RULE_TITLE_REQUIRED";
    throw error;
  }

  if (!rule.category) {
    const error = new Error("请选择规则分类");
    error.code = "AUDIT_RULE_CATEGORY_REQUIRED";
    throw error;
  }

  if (!rule.description) {
    const error = new Error("请填写规则说明");
    error.code = "AUDIT_RULE_DESCRIPTION_REQUIRED";
    throw error;
  }

  const id = crypto.randomUUID();
  database
    .prepare(`
      INSERT INTO audit_rules
        (id, title, category, risk_level, decision, keywords_json, description,
         positive_examples_json, negative_examples_json, suggested_action, enabled,
         source_sample_id, created_by, created_by_name, created_at, updated_at)
      VALUES
        (@id, @title, @category, @risk_level, @decision, @keywords_json, @description,
         @positive_examples_json, @negative_examples_json, @suggested_action, @enabled,
         @source_sample_id, @created_by, @created_by_name, @created_at, @updated_at)
    `)
    .run({
      id,
      ...toAuditRuleDbFields(rule),
      created_by: cleanText(user?.id),
      created_by_name: cleanText(user?.name || user?.username),
      created_at: now,
      updated_at: now,
    });

  return getAuditRule(id);
}

export function updateAuditRule(id, payload) {
  const existing = getAuditRule(id);

  if (!existing) return null;

  const rule = normalizeAuditRuleInput({ ...existing, ...payload });

  if (!rule.title || !rule.category || !rule.description) {
    const error = new Error("规则名称、分类和说明不能为空");
    error.code = "AUDIT_RULE_REQUIRED_FIELDS";
    throw error;
  }

  database
    .prepare(`
      UPDATE audit_rules
      SET title = @title,
          category = @category,
          risk_level = @risk_level,
          decision = @decision,
          keywords_json = @keywords_json,
          description = @description,
          positive_examples_json = @positive_examples_json,
          negative_examples_json = @negative_examples_json,
          suggested_action = @suggested_action,
          enabled = @enabled,
          source_sample_id = @source_sample_id,
          updated_at = @updated_at
      WHERE id = @id
    `)
    .run({
      id: String(id),
      ...toAuditRuleDbFields(rule),
      updated_at: new Date().toISOString(),
    });

  return getAuditRule(id);
}

export function toggleAuditRule(id, enabled) {
  const existing = getAuditRule(id);

  if (!existing) return null;

  database
    .prepare(
      "UPDATE audit_rules SET enabled = ?, updated_at = ? WHERE id = ?",
    )
    .run(enabled ? 1 : 0, new Date().toISOString(), String(id));

  return getAuditRule(id);
}

export function deleteAuditRule(id) {
  const result = database
    .prepare("DELETE FROM audit_rules WHERE id = ?")
    .run(String(id ?? ""));

  return result.changes > 0;
}

function normalizeAuditRule(row) {
  return {
    id: cleanText(row.id),
    title: cleanText(row.title),
    category: cleanText(row.category),
    risk_level: cleanText(row.risk_level) || "中",
    decision: cleanText(row.decision) || "建议人工审核",
    keywords: parseJsonValue(row.keywords_json, []),
    description: cleanText(row.description),
    positive_examples: parseJsonValue(row.positive_examples_json, []),
    negative_examples: parseJsonValue(row.negative_examples_json, []),
    suggested_action: cleanText(row.suggested_action),
    enabled: Number(row.enabled) === 1,
    source_sample_id: cleanText(row.source_sample_id),
    created_by: cleanText(row.created_by),
    created_by_name: cleanText(row.created_by_name) || "未知创建人",
    created_at: cleanText(row.created_at),
    updated_at: cleanText(row.updated_at),
  };
}

function normalizeAuditRuleInput(value = {}) {
  return {
    title: cleanText(value.title).slice(0, 120),
    category: cleanText(value.category).slice(0, 60),
    risk_level: ["无", "低", "中", "高"].includes(value.risk_level)
      ? value.risk_level
      : "中",
    decision:
      value.decision === "通过" ? "通过" : "建议人工审核",
    keywords: normalizeStringList(value.keywords, 30, 40),
    description: cleanText(value.description).slice(0, 3000),
    positive_examples: normalizeStringList(value.positive_examples, 20, 300),
    negative_examples: normalizeStringList(value.negative_examples, 20, 300),
    suggested_action: cleanText(value.suggested_action).slice(0, 1000),
    enabled: value.enabled === false || value.enabled === 0 ? false : true,
    source_sample_id: cleanText(value.source_sample_id).slice(0, 200),
  };
}

function toAuditRuleDbFields(rule) {
  return {
    title: rule.title,
    category: rule.category,
    risk_level: rule.risk_level,
    decision: rule.decision,
    keywords_json: stringifyJson(rule.keywords, []),
    description: rule.description,
    positive_examples_json: stringifyJson(rule.positive_examples, []),
    negative_examples_json: stringifyJson(rule.negative_examples, []),
    suggested_action: rule.suggested_action,
    enabled: rule.enabled ? 1 : 0,
    source_sample_id: rule.source_sample_id,
  };
}

function normalizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name || user.username,
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

function normalizeAuditRun(row, includePayload) {
  const summary = parseJsonValue(row.summary_json, {});
  const accounts = includePayload
    ? parseJsonValue(row.accounts_json, [])
    : parseJsonValue(row.accounts_json, []);
  const videos = includePayload
    ? parseJsonValue(row.videos_json, [])
    : parseJsonValue(row.videos_json, []);

  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: cleanText(row.created_by),
    created_by_name: cleanText(row.created_by_name) || "未知创建人",
    status: row.status,
    note: row.note,
    summary,
    account_count:
      Number(summary.account_count) ||
      (Array.isArray(accounts) ? accounts.length : 0),
    video_count:
      Number(summary.video_count) || (Array.isArray(videos) ? videos.length : 0),
    ...(includePayload
      ? {
          defaultRange: parseJsonValue(row.default_range_json, {}),
          accountTasks: parseJsonValue(row.account_tasks_json, []),
          accounts,
          videos,
          auditResults: parseJsonValue(row.audit_results_json, {}),
          manualReviews: parseJsonValue(row.manual_reviews_json, {}),
          feedbacks: parseJsonValue(row.feedbacks_json, {}),
        }
      : {}),
  };
}

function stringifyJson(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function parseJsonValue(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeAuditRunStatus(value) {
  return ["pending", "fetched", "auditing", "completed", "failed"].includes(
    value,
  )
    ? value
    : "pending";
}

function defaultAuditRunTitle(isoDate) {
  return `短视频质检 ${isoDate.slice(0, 16).replace("T", " ")}`;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeStringList(value, maxItems, maxLength) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[\n,，、]/u)
        .map((item) => item.trim());
  const seen = new Set();
  const result = [];

  for (const item of list) {
    const text = cleanText(item).slice(0, maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= maxItems) break;
  }

  return result;
}

export function closeDatabase() {
  database.close();
}
