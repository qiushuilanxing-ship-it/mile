import assert from "node:assert/strict";
import test from "node:test";
import {
  processInSequentialBatches,
  summarizeAuditResults,
  withTimeout,
} from "./audit-batches.js";

test("processes five items concurrently and waits before the next batch", async () => {
  const events = [];
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 12 }, (_, index) => index + 1);
  const results = await processInSequentialBatches(
    items,
    async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`start-${item}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`end-${item}`);
      active -= 1;
      return item * 2;
    },
    5,
  );

  assert.deepEqual(results, items.map((item) => item * 2));
  assert.equal(maxActive, 5);
  assert.ok(events.indexOf("end-5") < events.indexOf("start-6"));
  assert.ok(events.indexOf("end-10") < events.indexOf("start-11"));
});

test("summarizes audit results for the workbench", () => {
  assert.deepEqual(
    summarizeAuditResults([
      { audit_result: "通过", risk_level: "无", audit_status: "completed" },
      {
        audit_result: "需整改",
        risk_level: "中",
        need_human_review: true,
        audit_status: "completed",
      },
      {
        audit_result: "高风险退回",
        risk_level: "高",
        audit_status: "completed",
      },
      {
        audit_result: "建议人工复核",
        risk_level: "低",
        need_human_review: true,
        audit_status: "failed",
      },
    ]),
    {
      total: 4,
      passed: 1,
      need_human_review: 2,
      need_fix: 1,
      high_risk: 1,
      failed: 1,
    },
  );
});

test("times out one audit item without waiting for the underlying promise", async () => {
  await assert.rejects(
    () =>
      withTimeout(
        new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
        10,
        "单条视频AI质检超时",
      ),
    (error) =>
      error.code === "AI_AUDIT_ITEM_TIMEOUT" &&
      error.message === "单条视频AI质检超时",
  );
});
