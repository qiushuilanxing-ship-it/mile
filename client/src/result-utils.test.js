import test from "node:test";
import assert from "node:assert/strict";
import {
  extractDisplayResult,
  formatDisplayResult,
} from "./result-utils.js";

test("prefers data over other result fields", () => {
  const result = extractDisplayResult({
    data: '{"answer":{"title":"优先展示"}}',
    result: "备用内容",
  });

  assert.deepEqual(result, { title: "优先展示" });
  assert.equal(
    formatDisplayResult(result),
    '{\n  "title": "优先展示"\n}',
  );
});

test("extracts the standardized backend result", () => {
  assert.equal(
    extractDisplayResult({
      success: true,
      result: '{"output":"最终生成结果"}',
    }),
    "最终生成结果",
  );
});

