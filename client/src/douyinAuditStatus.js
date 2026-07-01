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
    notAudited: videos.filter((video) => matchesFilter(video, "notAudited")).length,
    human: videos.filter((video) => matchesFilter(video, "human")).length,
    rejected: videos.filter((video) => matchesFilter(video, "rejected")).length,
    passed: videos.filter((video) => matchesFilter(video, "passed")).length,
    failed: videos.filter((video) => matchesFilter(video, "failed")).length,
  };
}

export function getFinalDecision(video, auditResult, manualReview) {
  const result = auditResult ?? video?.auditResult ?? null;
  const review = manualReview ?? video?.manualReview ?? null;
  const manualStatus = review?.status || "";
  const videoAuditStatus = String(video?.ai_audit_status || "").toLowerCase();
  const hasStartedAudit = [
    "pending",
    "auditing",
    "completed",
    "failed",
    "timeout",
    "error",
  ].includes(videoAuditStatus);

  if (!result && (!hasStartedAudit || videoAuditStatus === "not_started")) {
    return {
      final_status: "not_audited",
      final_label: "待AI质检",
      final_reason: "已获取作品，尚未开始 AI 质检",
      source: "system",
    };
  }

  const isAuditFailed =
    ["failed", "timeout", "error"].includes(videoAuditStatus) ||
    ["failed", "timeout", "error"].includes(result?.audit_status) ||
    result?.main_risks?.includes?.("AI返回格式异常") ||
    (hasStartedAudit && !result && videoAuditStatus !== "pending" && videoAuditStatus !== "auditing");

  if (isAuditFailed) {
    return {
      final_status: "audit_failed",
      final_label: "质检失败",
      final_reason: "AI质检失败，建议重试或人工查看",
      source: "system",
    };
  }

  if (!result) {
    return {
      final_status: "not_audited",
      final_label: videoAuditStatus === "auditing" ? "质检中" : "待AI质检",
      final_reason:
        videoAuditStatus === "auditing"
          ? "AI 正在质检该视频"
          : "已进入 AI 质检队列，等待返回结果",
      source: "system",
    };
  }

  if (manualStatus === "approved") {
    return {
      final_status: "publishable",
      final_label: "可发布",
      final_reason: "人工确认通过",
      source: "manual",
    };
  }

  if (manualStatus === "rejected") {
    return {
      final_status: "rejected",
      final_label: "退回修改",
      final_reason: "人工审核退回修改",
      source: "manual",
    };
  }

  if (manualStatus === "ignored") {
    return {
      final_status: "ignored",
      final_label: "已忽略",
      final_reason: "人工已忽略该条",
      source: "manual",
    };
  }

  const shouldHumanReview =
    result.need_human_review === true ||
    ["建议人工复核", "需整改", "高风险退回"].includes(result.audit_result) ||
    ["中", "高"].includes(result.risk_level);

  if (shouldHumanReview) {
    return {
      final_status: "pending_review",
      final_label: "待人工审核",
      final_reason: "AI建议人工审核",
      source: "ai",
    };
  }

  if (result.audit_result === "通过" && result.need_human_review === false) {
    return {
      final_status: "publishable",
      final_label: "可发布",
      final_reason: "AI未发现明显风险",
      source: "ai",
    };
  }

  if (result.audit_result === "通过" || result.need_human_review === false) {
    return {
      final_status: "publishable",
      final_label: "可发布",
      final_reason: "AI未发现明显风险",
      source: "ai",
    };
  }

  return {
    final_status: "pending_review",
    final_label: "待人工审核",
    final_reason: "状态不明确，建议人工查看",
    source: "system",
  };
}

export function matchesFilter(videoOrResult, filter) {
  if (filter === "all") return true;
  const directResult =
    videoOrResult &&
    !videoOrResult.auditResult &&
    ("audit_result" in videoOrResult || "audit_status" in videoOrResult)
      ? videoOrResult
      : null;
  const decision =
    videoOrResult?.finalDecision ??
    getFinalDecision(
      videoOrResult,
      videoOrResult?.auditResult ?? directResult,
      videoOrResult?.manualReview,
    );
  const status = decision.final_status;
  if (filter === "notAudited") return status === "not_audited";
  if (filter === "human") {
    return ["pending_review", "ignored"].includes(status);
  }
  if (filter === "rejected") return status === "rejected";
  if (filter === "passed") return status === "publishable";
  if (filter === "failed") return status === "audit_failed";
  return true;
}
