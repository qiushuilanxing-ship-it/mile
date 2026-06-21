import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPreferredResult,
  extractWorkflowResult,
  extractWorkflowResultWithFallback,
  normalizeUsage,
  parseSseEvents,
} from "./coze-stream.js";

test("parses SSE and extracts only the final End message", () => {
  const payload = [
    "event: PING\ndata: {}",
    'event: Message\ndata: {"content":"中间片段","node_is_finish":false}',
    'event: Message\ndata: {"content":"{\\"output\\":\\"最终结果\\"}","node_type":"End","node_is_finish":true,"usage":{"token_count":123}}',
    'event: Done\ndata: {"debug_url":"https://www.coze.cn/debug"}',
  ].join("\n\n");

  const result = extractWorkflowResult(parseSseEvents(payload));

  assert.equal(result.result, "最终结果");
  assert.equal(result.usage.token_count, 123);
  assert.equal(result.debugUrl, "https://www.coze.cn/debug");
  assert.equal(result.raw.final_message.content.includes("中间片段"), false);
});

test("prefers data, answer, and output when unwrapping results", () => {
  assert.equal(
    extractPreferredResult({
      output: "备用结果",
      data: '{"answer":"优先结果"}',
    }),
    "优先结果",
  );
});

test("returns formatted objects after unwrapping JSON strings", () => {
  assert.deepEqual(
    extractPreferredResult('{"data":{"title":"结果","items":[1,2]}}'),
    { title: "结果", items: [1, 2] },
  );
});

test("throws with raw Coze error fields", () => {
  const events = parseSseEvents(
    'event: Error\ndata: {"code":4200,"msg":"Workflow not found","detail":{"logid":"abc"}}',
  );

  assert.throws(
    () => extractWorkflowResult(events),
    (error) => {
      assert.equal(error.message, "Coze 工作流执行失败，请稍后重试。");
      assert.deepEqual(error.raw, {
        code: 4200,
        msg: "Workflow not found",
        detail: { logid: "abc" },
      });
      return true;
    },
  );
});

test("does not treat intermediate messages as a final result", () => {
  const events = parseSseEvents(
    [
      'event: Message\ndata: {"content":"片段一"}',
      'event: Message\ndata: {"content":"片段二"}',
      "event: Done\ndata: {}",
    ].join("\n\n"),
  );

  assert.throws(
    () => extractWorkflowResult(events),
    /未返回最终生成结果/,
  );
});

test("falls back to a final_message object when SSE parsing is incomplete", () => {
  const result = extractWorkflowResultWithFallback(
    JSON.stringify({
      final_message: {
        data: '{"output":"回退结果"}',
        usage: { token_count: 88 },
      },
    }),
  );

  assert.equal(result.result, "回退结果");
  assert.equal(result.usage.token_count, 88);
  assert.equal(result.raw.fallback, true);
});

test("marks empty final output so the caller can retry once", () => {
  const events = parseSseEvents(
    'event: Message\ndata: {"content":"","node_type":"End","node_is_finish":true}',
  );

  assert.throws(
    () => extractWorkflowResult(events),
    (error) => {
      assert.equal(error.code, "EMPTY_RESULT");
      return true;
    },
  );
});

test("falls back to an ordinary HTTP JSON result when SSE is unavailable", () => {
  const result = extractWorkflowResultWithFallback(
    JSON.stringify({
      code: 0,
      data: {
        output: "HTTP 降级结果",
        usage: {
          input_tokens: 40,
          output_tokens: 12,
        },
      },
    }),
  );

  assert.equal(result.result, "HTTP 降级结果");
  assert.equal(result.usage.token_count, 52);
  assert.equal(result.raw.fallback, true);
});

test("normalizes common Coze token usage formats", () => {
  assert.equal(normalizeUsage({ total_tokens: 90 }).token_count, 90);
  assert.equal(
    normalizeUsage({ prompt_tokens: 20, completion_tokens: 7 }).token_count,
    27,
  );
  assert.equal(normalizeUsage(null).token_count, 0);
});
