export async function processInSequentialBatches(
  items,
  worker,
  batchSize = 5,
  options = {},
) {
  const results = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchIndex = Math.floor(index / batchSize);
    await options.onBatchStart?.({
      batch,
      batchIndex,
      totalBatches: Math.ceil(items.length / batchSize),
    });
    const batchResults = await Promise.all(batch.map(worker));
    results.push(...batchResults);
    await options.onBatchEnd?.({
      batch,
      batchIndex,
      batchResults,
      totalBatches: Math.ceil(items.length / batchSize),
    });
  }

  return results;
}

export function withTimeout(promise, ms, message) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(message);
      error.code = "AI_AUDIT_ITEM_TIMEOUT";
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

export function summarizeAuditResults(results) {
  return {
    total: results.length,
    passed: results.filter((result) => result.audit_result === "通过").length,
    need_human_review: results.filter(
      (result) =>
        result.need_human_review === true ||
        result.audit_result === "建议人工复核",
    ).length,
    need_fix: results.filter((result) => result.audit_result === "需整改")
      .length,
    high_risk: results.filter(
      (result) =>
        result.audit_result === "高风险退回" || result.risk_level === "高",
    ).length,
    failed: results.filter((result) =>
      ["failed", "timeout"].includes(result.audit_status),
    ).length,
  };
}
