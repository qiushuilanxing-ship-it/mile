import assert from "node:assert/strict";
import test from "node:test";
import {
  AiAuditInputError,
  auditDouyinVideosWithModel,
  buildAuditItems,
  matchRulesForDescription,
  normalizeAuditResults,
  prepareAuditVideos,
} from "./douyin-ai-audit.js";

const rules = [
  {
    rule_id: "R-001",
    rule_name: "极限词",
    category: "文案",
    sub_category: "广告词",
    risk_level: "高",
    keywords: ["全网最低", "第一"],
    standard: "不得使用绝对化表达",
    risk_reason: "可能误导消费者",
    rectification: "改为客观描述",
  },
  {
    rule_id: "R-002",
    rule_name: "站外导流",
    category: "导流",
    sub_category: "第三方",
    risk_level: "高",
    keywords: ["加微信"],
    standard: "不得引导站外交易",
    risk_reason: "平台交易风险",
    rectification: "改为平台内咨询",
  },
];

test("validates and sanitizes audit videos", () => {
  assert.deepEqual(
    prepareAuditVideos([
      {
        video_id: "video-1",
        secUid: "account-1",
        account_index: 1,
        account_range_label: "最近7天",
        account_range_type: "last7",
        author_name: "作者",
        create_time: "2026-06-24 12:00:00",
        create_time_ts: 1_782_279_200,
        duration: 15_000,
        desc: "测试描述",
        page_url: "https://example.com",
        cover_url: "https://example.com/cover.jpg",
        play_url: "https://example.com/video.mp4",
      },
    ]),
    [
      {
        video_id: "video-1",
        secUid: "account-1",
        account_index: 1,
        account_range_label: "最近7天",
        account_range_type: "last7",
        author_name: "作者",
        frontend_name: "",
        erp_name: "",
        operator: "",
        douyin_id: "",
        door_no: "",
        business_status: "",
        live_status: "",
        profile_matched: false,
        create_time: "2026-06-24 12:00:00",
        create_time_ts: 1_782_279_200,
        duration: 15_000,
        desc: "测试描述",
        page_url: "https://example.com",
        cover_url: "https://example.com/cover.jpg",
        play_url: "https://example.com/video.mp4",
      },
    ],
  );
  assert.throws(() => prepareAuditVideos([]), AiAuditInputError);
  assert.throws(
    () => prepareAuditVideos(Array.from({ length: 501 }, () => ({}))),
    AiAuditInputError,
  );
});

test("matches local rules by keywords in description", () => {
  const matched = matchRulesForDescription(
    "全网最低，欢迎加微信了解详情",
    rules,
  );

  assert.equal(matched.length, 2);
  assert.deepEqual(matched[0].matched_keywords, ["全网最低"]);
  assert.deepEqual(matched[1].matched_keywords, ["加微信"]);
});

test("builds model audit items with matched rules", () => {
  const items = buildAuditItems(
    [
      {
        video_id: "video-1",
        author_name: "作者",
        create_time: "2026-06-24 12:00:00",
        desc: "我们是第一",
        page_url: "https://example.com",
      },
    ],
    rules,
  );

  assert.equal(items[0].matched_rules[0].rule_id, "R-001");
});

test("normalizes model results and rejects hallucinated rule ids", () => {
  const items = buildAuditItems(
    [
      {
        video_id: "video-1",
        desc: "全网最低",
      },
      {
        video_id: "video-2",
        desc: "普通新品介绍",
      },
    ],
    rules,
  );
  const results = normalizeAuditResults(
    [
      {
        video_id: "video-1",
        audit_result: "需整改",
        risk_level: "高",
        main_risks: ["绝对化宣传"],
        hit_rules: ["R-001", "NOT-ALLOWED"],
        problem_description: "使用全网最低",
        rectification_suggestion: "改为限时活动价",
        need_human_review: true,
      },
    ],
    items,
  );

  assert.deepEqual(results[0].hit_rules, ["R-001"]);
  assert.equal(results[1].audit_result, "通过");
  assert.equal(results[1].risk_level, "无");
});

test("calls an OpenAI-compatible text model and parses structured results", async () => {
  const items = buildAuditItems(
    [
      {
        video_id: "video-1",
        desc: "全网最低",
      },
    ],
    rules,
  );
  const requests = [];
  const results = await auditDouyinVideosWithModel({
    auditItems: items,
    apiBase: "https://model.example/v1",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      video_id: "video-1",
                      audit_result: "需整改",
                      risk_level: "高",
                      main_risks: ["绝对化宣传"],
                      hit_rules: ["R-001"],
                      problem_description: "使用全网最低",
                      rectification_suggestion: "改为限时活动价",
                      need_human_review: true,
                    },
                  ],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://model.example/v1/chat/completions");
  assert.equal(results[0].video_id, "video-1");
  assert.equal(results[0].audit_result, "需整改");
  assert.deepEqual(results[0].hit_rules, ["R-001"]);
});
