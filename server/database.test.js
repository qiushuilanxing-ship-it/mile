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
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "StrongAdminPass!2026";
  process.env.ADMIN_NAME = "管理员";

  const database = await import(`./database.js?test=${Date.now()}`);

  try {
    const admin = database.authenticateUser("admin", "StrongAdminPass!2026");
    const content = database.upsertUser({
      username: "content",
      password: "ContentPass!2026",
      role: "content",
      department: "content",
    });
    const ops = database.upsertUser({
      username: "ops",
      password: "OpsPass!2026",
      role: "viewer",
      department: "ops",
    });

    assert.equal(admin.role, "admin");
    assert.equal(admin.name, "管理员");
    assert.equal(content.role, "content");
    assert.equal(ops.role, "viewer");
    assert.equal(database.authenticateUser("admin", "admin"), null);
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

    const savedRun = database.upsertAuditRun({
      title: "短视频质检 - 账号数 1 - 视频数 1",
      createdBy: content.id,
      createdByName: content.username,
      defaultRange: { rangeType: "last7" },
      accountTasks: [{ secUid: "sec-1", rangeType: "default" }],
      accounts: [{ secUid: "sec-1", count: 1 }],
      videos: [{ video_id: "video-1", desc: "直播间福利大放送" }],
      auditResults: {
        "video-1": {
          video_id: "video-1",
          audit_result: "通过",
          need_human_review: true,
        },
      },
      manualReviews: {
        "video-1": {
          status: "approved",
          note: "manual approved",
          reviewed_by: String(content.id),
          reviewed_by_name: content.username,
          reviewed_at: "2026-06-27T10:00:00.000Z",
        },
      },
      summary: {
        account_count: 1,
        video_count: 1,
        manualReviewCounts: { approved: 1 },
        filter_counts: { human: 1 },
      },
      status: "completed",
    });

    assert.equal(savedRun.created_by, String(content.id));
    assert.equal(savedRun.created_by_name, "content");
    assert.equal(savedRun.video_count, 1);
    assert.equal(savedRun.videos[0].video_id, "video-1");
    assert.equal(savedRun.manualReviews["video-1"].status, "approved");
    assert.equal(savedRun.manualReviews["video-1"].note, "manual approved");
    assert.equal(
      database.getLatestAuditRun({ createdBy: content.id }).id,
      savedRun.id,
    );
    assert.equal(database.getLatestAuditRun({ createdBy: admin.id }), null);

    const runList = database.listAuditRuns({
      createdBy: content.id,
      limit: 20,
    });
    assert.equal(runList.length, 1);
    assert.equal(runList[0].created_by_name, "content");
    assert.equal(runList[0].video_count, 1);
    assert.equal(Object.hasOwn(runList[0], "videos"), false);
    assert.equal(Object.hasOwn(runList[0], "manualReviews"), false);
    assert.equal(
      database.listAuditRuns({ createdBy: admin.id, limit: 20 }).length,
      0,
    );
    assert.equal(
      database.listAuditRuns({ createdBy: admin.id, limit: 20, allUsers: true })
        .length,
      1,
    );

    const updatedRun = database.upsertAuditRun({
      ...savedRun,
      createdBy: content.id,
      videos: [{ video_id: "video-2" }],
      manualReviews: {
        "video-2": {
          status: "rejected",
          note: "manual rejected",
        },
      },
      summary: { account_count: 1, video_count: 1 },
      status: "fetched",
    });
    assert.equal(updatedRun.id, savedRun.id);
    assert.equal(updatedRun.status, "fetched");
    assert.equal(updatedRun.videos[0].video_id, "video-2");
    assert.equal(updatedRun.manualReviews["video-2"].status, "rejected");
    assert.throws(
      () => database.getAuditRun({ id: savedRun.id, createdBy: admin.id }),
      /无权限查看/,
    );
    assert.equal(
      database.getAuditRun({
        id: savedRun.id,
        createdBy: admin.id,
        canReadAll: true,
      }).id,
      savedRun.id,
    );
    assert.throws(
      () => database.deleteAuditRun({ id: savedRun.id, createdBy: admin.id }),
      /无权限删除/,
    );
    assert.throws(
      () =>
        database.upsertAuditRun({
          id: savedRun.id,
          createdBy: admin.id,
          title: "越权更新",
        }),
      /无权限修改/,
    );
    assert.equal(
      database.upsertAuditRun({
        id: savedRun.id,
        createdBy: admin.id,
        createdByName: admin.username,
        title: "管理员更新",
        canUpdateAll: true,
      }).title,
      "管理员更新",
    );
    assert.equal(
      database.deleteAuditRun({
        id: savedRun.id,
        createdBy: admin.id,
        canDeleteAll: true,
      }),
      true,
    );
    assert.equal(
      database.getAuditRun({ id: savedRun.id, createdBy: content.id }),
      null,
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
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_NAME;
  }
});

test("does not create a default admin when ADMIN_PASSWORD is missing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "company-ai-tools-"));
  const databasePath = path.join(directory, "test.db");
  process.env.SQLITE_PATH = databasePath;
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_NAME;

  const database = await import(`./database.js?test=no-admin-${Date.now()}`);

  try {
    assert.equal(database.authenticateUser("admin", "admin"), null);
  } finally {
    database.closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.SQLITE_PATH;
  }
});
