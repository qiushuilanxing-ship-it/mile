import assert from "node:assert/strict";
import test from "node:test";
import { getDisplayAuditStatus, getFilterCounts } from "./douyinAuditStatus.js";

test("maps low-risk pass into the passed bucket", () => {
  const result = {
    audit_result: "通过",
    risk_level: "低",
    need_human_review: false,
    audit_status: "completed",
  };

  assert.deepEqual(getDisplayAuditStatus(result), {
    key: "passed",
    label: "通过",
    tone: "passed",
    showRiskLabel: false,
  });
});

test("maps old rectification and high-risk model outputs into human review", () => {
  for (const result of [
    { audit_result: "需整改", risk_level: "中" },
    { audit_result: "高风险退回", risk_level: "高" },
    { audit_result: "建议人工复核", risk_level: "低" },
    { audit_result: "通过", risk_level: "中" },
    { audit_result: "未知", main_risks: ["疑似规则缺失"] },
    { audit_result: "未知", hit_rules: ["R-001"] },
  ]) {
    assert.equal(getDisplayAuditStatus(result).key, "human");
    assert.equal(getDisplayAuditStatus(result).label, "建议人工审核");
  }
});

test("counts only all, human review, passed, and failed categories", () => {
  const counts = getFilterCounts([
    {
      auditResult: {
        audit_result: "通过",
        risk_level: "低",
        need_human_review: false,
      },
    },
    {
      auditResult: {
        audit_result: "需整改",
        risk_level: "中",
        need_human_review: true,
      },
    },
    {
      auditResult: {
        audit_result: "高风险退回",
        risk_level: "高",
        need_human_review: true,
      },
    },
    {
      auditResult: {
        audit_status: "timeout",
        audit_result: "建议人工复核",
      },
    },
  ]);

  assert.deepEqual(counts, {
    all: 4,
    human: 2,
    passed: 1,
    failed: 1,
  });
});
