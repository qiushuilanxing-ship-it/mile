import assert from "node:assert/strict";
import test from "node:test";
import {
  auditVideoWithText,
  auditVideoWithVision,
  buildTextAuditPrompt,
  buildVisionAuditPrompt,
  callArkResponses,
  createProviderFallback,
  extractResponsesText,
  isValidVideoUrl,
  LLMConfigurationError,
  LLMProviderError,
} from "./llmClient.js";

const video = {
  video_id: "video-1",
  author_name: "测试账号",
  create_time: "2026-06-25 12:00:00",
  desc: "全网最低，欢迎加微信了解",
  page_url: "https://www.douyin.com/video/video-1",
  play_url: "https://v.douyinvod.com/video/tos/cn/video-1.mp4",
};
const matchedRules = [
  {
    rule_id: "R-001",
    rule_name: "极限词",
    category: "广告宣传",
    standard: "不得使用绝对化表述",
    rectification: "改为客观描述",
    matched_keywords: ["全网最低"],
  },
];

function modelResponse(overrides = {}) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              video_id: "video-1",
              audit_result: "需整改",
              risk_level: "高",
              main_risks: ["使用绝对化宣传"],
              hit_rules: ["R-001"],
              evidence: "标题描述出现“全网最低”",
              visual_evidence: "画面贴片出现“全网最低”",
              problem_description: "文案和画面均使用绝对化表达。",
              rectification_suggestion: "删除绝对化表达。",
              need_human_review: true,
              ...overrides,
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function responsesModelResponse(overrides = {}) {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        video_id: "video-1",
        audit_result: "需整改",
        risk_level: "高",
        main_risks: ["使用绝对化宣传"],
        hit_rules: ["R-001"],
        evidence: "标题描述出现“全网最低”",
        visual_evidence: "画面贴片出现“全网最低”",
        problem_description: "文案和画面均使用绝对化表达。",
        rectification_suggestion: "删除绝对化表达。",
        need_human_review: true,
        ...overrides,
      }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

test("recognizes video URLs and rejects audio URLs", () => {
  assert.equal(isValidVideoUrl(video.play_url), true);
  assert.equal(
    isValidVideoUrl("https://example.com/aweme/v1/play?id=123"),
    true,
  );
  assert.equal(isValidVideoUrl("https://example.com/file.mp3"), false);
  assert.equal(isValidVideoUrl("https://example.com/ies-music/123"), false);
  assert.equal(isValidVideoUrl("https://example.com/unknown"), false);
});

test("vision prompt treats routine price and subsidy expressions as normal activity guidance", () => {
  const prompt = buildVisionAuditPrompt(
    {
      ...video,
      desc: "RedMi X85 2026 直播间国补到手4419，现在下单还有惊喜福利，快来看看吧",
    },
    matchedRules,
  );

  assert.match(prompt, /常规电商活动表达，本身不等于违规/u);
  assert.match(prompt, /没有极限词、站外导流、价格冲突、强承诺或明显规则缺失时，应判“通过”/u);
  assert.match(prompt, /RedMi X85 2026 直播间国补到手4419/u);
  assert.match(prompt, /risk_level 为“无”/u);
  assert.match(prompt, /need_human_review=false/u);
});

test("text prompt does not escalate routine activity wording to manual review", () => {
  const prompt = buildTextAuditPrompt(
    {
      ...video,
      desc: "直播间福利大放送，价格4XXX，到手价很香，进直播间看看",
    },
    matchedRules,
  );

  assert.match(prompt, /不要因为出现国补、到手价、直播间福利/u);
  assert.match(prompt, /自动输出“建议人工复核”/u);
  assert.match(prompt, /没有其他违规证据，应判“通过”/u);
  assert.match(prompt, /risk_level 必须为“无”/u);
  assert.match(prompt, /need_human_review=false/u);
});

test("sends the play URL directly to Volcengine Ark vision input", async () => {
  const requests = [];
  const result = await auditVideoWithVision(video, matchedRules, {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "test-key",
    model: "doubao-seed-2-1-turbo-260628",
    includeDebug: true,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return modelResponse();
    },
  });

  assert.equal(
    requests[0].url,
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  );
  const requestBody = JSON.parse(requests[0].options.body);
  const content = requestBody.messages[1].content;
  assert.equal(content[0].type, "video_url");
  assert.equal(content[0].video_url.url, video.play_url);
  assert.equal(content[0].video_url.fps, 2);
  assert.equal(content[1].type, "text");
  assert.match(content[1].text, /视频画面、字幕、贴片/u);
  assert.equal(result.audit_mode, "video");
  assert.equal(result.visual_status, "success");
  assert.equal(result.evidence, "标题描述出现“全网最低”");
  assert.equal(result.visual_evidence, "画面贴片出现“全网最低”");
  assert.equal(result.debug.desc, video.desc);
  assert.equal(result.debug.raw_response.choices.length, 1);
});

test("text audit does not send video content and carries fallback metadata", async () => {
  const requests = [];
  const result = await auditVideoWithText(video, matchedRules, {
    baseUrl: "https://ark.example/api/v3",
    apiKey: "test-key",
    model: "test-model",
    auditMode: "text_fallback",
    visualStatus: "failed",
    visualError: "视频 URL 无法访问",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return modelResponse({
        audit_result: "建议人工复核",
        risk_level: "中",
        visual_evidence: "",
      });
    },
  });

  assert.equal(typeof requests[0].messages[1].content, "string");
  assert.doesNotMatch(requests[0].messages[1].content, /"type":"video_url"/u);
  assert.equal(result.audit_mode, "text_fallback");
  assert.equal(result.visual_status, "failed");
  assert.equal(result.visual_error, "视频 URL 无法访问");
  assert.equal(result.need_human_review, true);
});

test("uses Ark Responses API with endpoint model and direct video input", async () => {
  const requests = [];
  const result = await auditVideoWithVision(video, matchedRules, {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "ark-test-key",
    model: "ep-20260625172737-wdtl2",
    apiType: "responses",
    includeDebug: true,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return responsesModelResponse();
    },
  });

  assert.equal(
    requests[0].url,
    "https://ark.cn-beijing.volces.com/api/v3/responses",
  );
  assert.equal(requests[0].body.model, "ep-20260625172737-wdtl2");
  assert.equal(requests[0].body.input[0].role, "system");
  assert.equal(requests[0].body.input[1].content[0].type, "input_video");
  assert.equal(
    requests[0].body.input[1].content[0].video_url,
    video.play_url,
  );
  assert.equal(requests[0].body.input[1].content[1].type, "input_text");
  assert.equal(result.model_used, "ep-20260625172737-wdtl2");
  assert.equal(result.api_type, "responses");
  assert.equal(result.debug.model_used, "ep-20260625172737-wdtl2");
  assert.equal(result.debug.visual_status, "success");
});

test("uses text-only content for Responses API text audit", async () => {
  const requests = [];
  const result = await auditVideoWithText(video, matchedRules, {
    baseUrl: "https://ark.example/api/v3",
    apiKey: "ark-test-key",
    model: "ep-test",
    apiType: "responses",
    auditMode: "text_fallback",
    visualStatus: "failed",
    visualError: "Responses API video_url unsupported or failed",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return responsesModelResponse({
        audit_result: "建议人工复核",
        risk_level: "低",
        visual_evidence: "",
      });
    },
  });

  assert.deepEqual(
    requests[0].input[1].content.map((item) => item.type),
    ["input_text"],
  );
  assert.equal(result.audit_mode, "text_fallback");
  assert.equal(result.api_type, "responses");
  assert.equal(result.need_human_review, true);
});

test("extracts text from Responses API output variants", () => {
  assert.equal(extractResponsesText({ output_text: "direct" }), "direct");
  assert.equal(
    extractResponsesText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "nested" },
            { type: "text", text: "second" },
          ],
        },
      ],
    }),
    "nested\nsecond",
  );
  assert.throws(
    () => extractResponsesText({ output: [] }),
    /无法解析 Responses API 返回文本/u,
  );
});

test("falls back to manual review when Responses output is not valid JSON", async () => {
  const result = await auditVideoWithText(video, matchedRules, {
    baseUrl: "https://ark.example/api/v3",
    apiKey: "ark-test-key",
    model: "ep-test",
    apiType: "responses",
    fetchImpl: async () =>
      new Response(JSON.stringify({ output_text: "无法形成结构化结果" }), {
        status: 200,
      }),
  });

  assert.equal(result.audit_result, "建议人工复核");
  assert.deepEqual(result.main_risks, ["AI返回格式异常"]);
  assert.equal(result.audit_mode, "text_fallback");
  assert.equal(result.visual_status, "failed");
  assert.equal(result.need_human_review, true);
});

test("marks Responses API model limits with the existing limit code", async () => {
  await assert.rejects(
    () =>
      callArkResponses({
        systemPrompt: "system",
        userText: "user",
        baseUrl: "https://ark.example/api/v3",
        apiKey: "ark-test-key",
        model: "ep-test",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: { message: "Safe Experience Mode inference limit" },
            }),
            { status: 429 },
          ),
      }),
    (error) =>
      error instanceof LLMProviderError &&
      error.code === "AI_MODEL_LIMIT_REACHED" &&
      error.api_type === "responses",
  );
});

test("rejects invalid video URLs before calling the model", async () => {
  await assert.rejects(
    () =>
      auditVideoWithVision(
        { ...video, play_url: "https://example.com/music/file.m4a" },
        matchedRules,
        {
          baseUrl: "https://ark.example/api/v3",
          apiKey: "test-key",
          model: "test-model",
        },
      ),
    LLMProviderError,
  );
});

test("extracts JSON from surrounding model text", async () => {
  const result = await auditVideoWithText(video, matchedRules, {
    baseUrl: "https://ark.example/api/v3",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '结果：\n```json\n{"video_id":"video-1","audit_result":"通过","risk_level":"无","main_risks":[],"hit_rules":[],"evidence":"","visual_evidence":"","problem_description":"","rectification_suggestion":"","need_human_review":false}\n```',
              },
            },
          ],
        }),
        { status: 200 },
      ),
  });

  assert.equal(result.audit_result, "通过");
  assert.equal(result.audit_mode, "text");
  assert.equal(result.visual_status, "no_video_url");
});

test("creates a final per-video fallback without failing the batch", () => {
  const fallback = createProviderFallback(
    video,
    new Error("火山方舟 AI 质检请求超时。"),
    {
      auditMode: "text_fallback",
      visualStatus: "failed",
      visualError: "视频理解超时",
    },
  );

  assert.equal(fallback.audit_result, "建议人工复核");
  assert.equal(fallback.audit_mode, "text_fallback");
  assert.equal(fallback.visual_status, "failed");
  assert.equal(fallback.visual_error, "视频理解超时");
});

test("does not expose debug details unless explicitly enabled", async () => {
  const result = await auditVideoWithText(video, matchedRules, {
    baseUrl: "https://ark.example/api/v3",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async () => modelResponse(),
  });

  assert.equal(Object.hasOwn(result, "debug"), false);
});

test("reports missing configuration and provider failures", async () => {
  await assert.rejects(
    () =>
      auditVideoWithText(video, matchedRules, {
        baseUrl: "",
        apiKey: "",
        model: "",
      }),
    LLMConfigurationError,
  );

  await assert.rejects(
    () =>
      auditVideoWithText(video, matchedRules, {
        baseUrl: "https://ark.example/api/v3",
        apiKey: "test-key",
        model: "test-model",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ error: { message: "invalid api key" } }),
            { status: 401 },
          ),
      }),
    LLMProviderError,
  );
});
