import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const databasePath =
  process.env.SQLITE_PATH ||
  path.join(currentDirectory, "data", "company-ai-tools.db");
const database = new Database(databasePath, { readonly: true });

const requiredLogColumns = [
  "id",
  "user_id",
  "type",
  "input",
  "output",
  "token_usage",
  "request_id",
  "created_at",
];
const logColumns = database
  .prepare("PRAGMA table_info(ai_logs)")
  .all()
  .map((column) => column.name);
const logs = database
  .prepare(
    "SELECT id, user_id, input, output, token_usage, request_id FROM ai_logs",
  )
  .all();
let malformedInputCount = 0;
let emptyOutputCount = 0;

for (const log of logs) {
  try {
    JSON.parse(log.input);
  } catch {
    malformedInputCount += 1;
  }

  if (!String(log.output || "").trim()) {
    emptyOutputCount += 1;
  }
}

const checks = {
  required_columns: requiredLogColumns.every((column) =>
    logColumns.includes(column),
  ),
  null_user_ids:
    database
      .prepare("SELECT COUNT(*) count FROM ai_logs WHERE user_id IS NULL")
      .get().count === 0,
  orphan_user_ids:
    database
      .prepare(`
        SELECT COUNT(*) count
        FROM ai_logs
        LEFT JOIN users ON users.id = ai_logs.user_id
        WHERE users.id IS NULL
      `)
      .get().count === 0,
  duplicate_request_ids:
    database
      .prepare(`
        SELECT COUNT(*) count
        FROM (
          SELECT user_id, request_id
          FROM ai_logs
          WHERE request_id IS NOT NULL
          GROUP BY user_id, request_id
          HAVING COUNT(*) > 1
        )
      `)
      .get().count === 0,
  non_negative_tokens:
    database
      .prepare("SELECT COUNT(*) count FROM ai_logs WHERE token_usage < 0")
      .get().count === 0,
  valid_input_json: malformedInputCount === 0,
  non_empty_outputs: emptyOutputCount === 0,
};
const report = {
  version: "5.0.0",
  passed: Object.values(checks).every(Boolean),
  checks,
  totals: database
    .prepare(`
      SELECT users.username, COUNT(ai_logs.id) calls,
             COALESCE(SUM(ai_logs.token_usage), 0) tokens
      FROM users
      LEFT JOIN ai_logs ON ai_logs.user_id = users.id
      GROUP BY users.id
      ORDER BY users.id
    `)
    .all(),
};

database.close();
console.log(JSON.stringify(report, null, 2));

if (!report.passed) {
  process.exitCode = 1;
}
