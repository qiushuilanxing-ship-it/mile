export function getDisplayAuditStatus(result) {
  if (!result) {
    return {
      key: "pending",
      label: "未质检",
      tone: "failed",
      showRiskLabel: false,
    };
  }

  if (["failed", "timeout", "error"].includes(result.audit_status)) {
    return {
      key: "failed",
      label: "失败",
      tone: "failed",
      showRiskLabel: false,
    };
  }

  const hasMainRisks =
    Array.isArray(result.main_risks) && result.main_risks.length > 0;
  const hasHitRules =
    Array.isArray(result.hit_rules) && result.hit_rules.length > 0;
  const isModelPass = result.audit_result === "通过";
  const shouldHumanReview =
    result.need_human_review === true ||
    ["建议人工复核", "需整改", "高风险退回"].includes(result.audit_result) ||
    ["中", "高"].includes(result.risk_level) ||
    (hasMainRisks && !isModelPass) ||
    (hasHitRules && !isModelPass);

  if (shouldHumanReview) {
    return {
      key: "human",
      label: "建议人工审核",
      tone: "human",
      showRiskLabel: false,
    };
  }

  if (isModelPass || result.need_human_review === false) {
    return {
      key: "passed",
      label: "通过",
      tone: "passed",
      showRiskLabel: false,
    };
  }

  return {
    key: "human",
    label: "建议人工审核",
    tone: "human",
    showRiskLabel: false,
  };
}

export function getFilterCounts(videos) {
  return {
    all: videos.length,
    human: videos.filter((video) => matchesFilter(video.auditResult, "human")).length,
    passed: videos.filter((video) => matchesFilter(video.auditResult, "passed")).length,
    failed: videos.filter((video) => matchesFilter(video.auditResult, "failed")).length,
  };
}

export function matchesFilter(result, filter) {
  if (filter === "all") return true;
  if (!result) return false;
  const status = getDisplayAuditStatus(result).key;
  if (filter === "human") return status === "human";
  if (filter === "passed") return status === "passed";
  if (filter === "failed") return status === "failed";
  return true;
}
