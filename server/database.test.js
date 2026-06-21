import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

test("isolates users, logs, sessions, stats, and simplified dashboards", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "company-ai-tools-"));
  const databasePath = path.join(directory, "test.db");
  process.env.SQLITE_PATH = databasePath;

  const database = await import(`./database.js?test=${Date.now()}`);

  try {
    const admin = database.authenticateUser("admin", "admin");
    const content = database.authenticateUser("content", "content");
    const ops = database.authenticateUser("ops", "ops");

    assert.equal(admin.role, "admin");
    assert.equal(content.role, "content");
    assert.equal(ops.role, "viewer");
    assert.equal(database.authenticateUser("admin", "wrong"), null);

    const session = database.createSession(admin.id, 60);
    assert.deepEqual(database.getUserBySessionToken(session.token), admin);

    database.addAiLog({
      userId: admin.id,
      input: { prompt: "生成产品视频提示词" },
      output: "测试结果",
      tokenUsage: 123,
    });

    assert.equal(database.listAiLogs({ userId: admin.id }).length, 1);
    assert.equal(database.listAiLogs({ userId: content.id }).length, 0);
    assert.equal(database.listAiLogs({ allUsers: true }).length, 1);
    assert.equal(database.getUsageStats(admin.id).total_tokens, 123);
    assert.equal(database.getPersonalDashboard(admin.id).stats.total_count, 1);
    assert.deepEqual(
      Object.keys(database.getPersonalDashboard(admin.id)).sort(),
      ["recent_history", "stats"],
    );

    const generationId = database.recordGeneration({
      userId: content.id,
      input: {
        prompt: "拆解参考视频并替换产品",
        video_file: { file_id: "video-1", name: "reference.mp4" },
      },
      output: { title: "测试标题" },
      tokenUsage: 45,
      requestId: "stable-request-id",
    });
    const generation = database.getGenerationByRequestId({
      userId: content.id,
      requestId: "stable-request-id",
    });

    assert.equal(generation.id, generationId);
    assert.equal(generation.type, "generation");
    assert.equal(generation.input.prompt, "拆解参考视频并替换产品");
    assert.deepEqual(generation.output, { title: "测试标题" });
    assert.equal(generation.token_usage, 45);
    assert.equal(database.getAdminDashboard().user_ranking.length, 3);
    assert.deepEqual(
      Object.keys(database.getAdminDashboard()).sort(),
      ["summary", "token_trend", "user_ranking"],
    );
    assert.throws(
      () =>
        database.recordGeneration({
          userId: content.id,
          input: { prompt: "重复" },
          output: "重复",
          tokenUsage: 1,
          requestId: "stable-request-id",
        }),
      /UNIQUE constraint failed/,
    );
  } finally {
    database.closeDatabase();

    const inspection = new Database(databasePath, { readonly: true });
    const tables = inspection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    const logColumns = inspection
      .prepare("PRAGMA table_info(ai_logs)")
      .all()
      .map((column) => column.name);
    inspection.close();

    assert.equal(tables.includes("prompt_templates"), false);
    assert.equal(logColumns.includes("template_id"), false);

    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
  }
});
