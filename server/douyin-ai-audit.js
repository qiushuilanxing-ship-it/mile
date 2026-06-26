import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRulesPath = path.join(
  currentDirectory,
  "data",
  "mile_quality_rules.json",
);
const validAuditResults = new Set([
  "通过",
  "需整改",
  "高风险退回",
  "建议人工复核",
]);
const validRiskLevels = new Set(["无", "低", "中", "高"]);

export class AiAuditInputError extends Error {}
export class AiAuditConfigurationError extends Error {}
export class AiAuditProviderError extends Error {}

export function loadQualityRules(rulesPath = defaultRulesPath) {
  if (!fs.existsSync(rulesPath)) {
    throw new AiAuditConfigurationError(
      "未找到米乐科技质检规则库，请先运行 npm run build:quality-rules。",
    );
  }

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

  if (!Array.isArray(rules) || rules.length === 0) {
    throw new AiAuditConfigurationError("米乐科技质检规则库为空。");
  }

  return rules;
}

export function prepareAuditVideos(videos) {
  if (!Array.isArray(videos)) {
    throw new AiAuditInputError("videos 必须是数组。");
  }

  if (videos.length === 0) {
    throw new AiAuditInputError("请先获取需要质检的视频。");
  }

  if (videos.length > 500) {
    throw new AiAuditInputError("一次最多质检 500 条视频。");
  }

  return videos.map((video, index) => {
    const videoId = clean(video?.video_id);

    if (!videoId) {
      throw new AiAuditInputError(`第 ${index + 1} 条视频缺少 video_id。`);
    }

    return {
      video_id: videoId,
      secUid: clean(video?.secUid),
      account_index: Number(video?.account_index) || 0,
      account_range_label: clean(video?.account_range_label),
      account_range_type: clean(video?.account_range_type),
      author_name: clean(video?.author_name),
      frontend_name: clean(video?.frontend_name),
      erp_name: clean(video?.erp_name),
      operator: clean(video?.operator),
      douyin_id: clean(video?.douyin_id),
      door_no: clean(video?.door_no),
      business_status: clean(video?.business_status),
      live_status: clean(video?.live_status),
      profile_matched: Boolean(video?.profile_matched),
      create_time: clean(video?.create_time),
      create_time_ts: Number(video?.create_time_ts) || 0,
      duration: Number(video?.duration) || 0,
      desc: clean(video?.desc).slice(0, 5000),
      page_url: clean(video?.page_url),
      cover_url: clean(video?.cover_url),
      play_url: clean(video?.play_url),
    };
  });
}

export function matchRulesForDescription(description, rules) {
  const normalizedDescription = clean(description).toLowerCase();

  if (!normalizedDescription) {
    return [];
  }

  return rules
    .map((rule) => {
      const matchedKeywords = (Array.isArray(rule.keywords)
        ? rule.keywords
        : []
      ).filter((keyword) =>
        normalizedDescription.includes(clean(keyword).toLowerCase()),
      );

      if (matchedKeywords.length === 0) {
        return null;
      }

      return {
        rule_id: clean(rule.rule_id),
        rule_name: clean(rule.rule_name),
        category: clean(rule.category),
        sub_category: clean(rule.sub_category),
        risk_level: clean(rule.risk_level),
        matched_keywords: matchedKeywords,
        standard: clean(rule.standard),
        risk_reason: clean(rule.risk_reason),
        rectification: clean(rule.rectification),
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

export function buildAuditItems(videos, rules) {
  return videos.map((video) => ({
    ...video,
    matched_rules: matchRulesForDescription(video.desc, rules),
  }));
}

export async function auditDouyinVideosWithModel({
  auditItems,
  apiBase,
  apiKey,
  model,
  fetchImpl = fetch,
  batchSize = 10,
}) {
  if (!apiBase || !apiKey || !model) {
    throw new AiAuditConfigurationError(
      "AI 质检模型尚未配置，请设置 AI_AUDIT_API_BASE、AI_AUDIT_API_KEY 和 AI_AUDIT_MODEL。",
    );
  }

  const results = [];

  for (let index = 0; index < auditItems.length; index += batchSize) {
    const batch = auditItems.slice(index, index + batchSize);
    const batchResults = await callTextAuditModel({
      batch,
      apiBase,
      apiKey,
      model,
      fetchImpl,
    });
    results.push(...normalizeAuditResults(batchResults, batch));
  }

  return results;
}

export function normalizeAuditResults(modelResults, auditItems) {
  const results = Array.isArray(modelResults) ? modelResults : [];
  const resultsByVideoId = new Map(
    results
      .filter((item) => item && typeof item === "object")
      .map((item) => [clean(item.video_id), item]),
  );

  return auditItems.map((item) => {
    const result = resultsByVideoId.get(item.video_id);

    if (!result) {
      return fallbackAuditResult(item);
    }

    const riskLevel = validRiskLevels.has(result.risk_level)
      ? result.risk_level
      : inferRiskLevel(item.matched_rules);
    const auditResult = validAuditResults.has(result.audit_result)
      ? result.audit_result
      : inferAuditResult(riskLevel, item.matched_rules);

    return {
      video_id: item.video_id,
      audit_result: auditResult,
      risk_level: riskLevel,
      main_risks: normalizeStringArray(result.main_risks),
      hit_rules: normalizeRuleIds(result.hit_rules, item.matched_rules),
      problem_description: clean(result.problem_description),
      rectification_suggestion: clean(result.rectification_suggestion),
      need_human_review:
        typeof result.need_human_review === "boolean"
          ? result.need_human_review
          : riskLevel !== "无",
      matched_rules: item.matched_rules,
    };
  });
}

async function callTextAuditModel({
  batch,
  apiBase,
  apiKey,
  model,
  fetchImpl,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetchImpl(
      `${apiBase.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: buildSystemPrompt(),
            },
            {
              role: "user",
              content: JSON.stringify({ videos: batch }),
            },
          ],
        }),
        signal: controller.signal,
      },
    );
    const responseText = await response.text();
    let responseData;

    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new AiAuditProviderError("AI 模型返回内容不是有效 JSON。");
    }

    if (!response.ok) {
      const error = new AiAuditProviderError(
        responseData?.error?.message ||
          `AI 模型请求失败，HTTP ${response.status}。`,
      );
      error.status = response.status;
      error.raw = responseData;
      throw error;
    }

    const content = responseData?.choices?.[0]?.message?.content;
    const parsedContent = parseModelJson(content);
    const results = Array.isArray(parsedContent)
      ? parsedContent
      : parsedContent?.results;

    if (!Array.isArray(results)) {
      throw new AiAuditProviderError("AI 模型未返回 results 数组。");
    }

    return results;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AiAuditProviderError("AI 质检请求超时。");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt() {
  return [
    "你是米乐科技短视频文本质检员。",
    "只审核视频描述 desc，不分析视频画面，不虚构未提供的信息。",
    "matched_rules 是本地关键词初筛候选，不代表一定违规；必须结合上下文综合判断。",
    "不要因为描述中出现国补、到手价、直播间福利、惊喜福利、下单福利、价格 4XXX、618/促销/活动价等常规电商活动表达，就自动输出“建议人工复核”。",
    "直播间价格、到手价、国补、福利、活动价、惊喜福利、下单福利、优惠活动等表述，本身不等于违规；如果只是引导用户到直播间查看活动，默认判定为“通过”，risk_level 必须为“无”，need_human_review 必须为 false。",
    "常规价格/福利表达可以在 rectification_suggestion 中轻微提示“发布前由运营确认活动价格、国补政策与后台一致即可”，但质检结论仍应为“通过”，risk_level 为“无”。",
    "只有出现明确但不完整且容易误导消费者的强价格承诺，才标记“建议人工复核”：例如具体到手价但商品型号、规格、活动条件完全无法判断；多个价格前后冲突；标题价格与描述价格明显不一致；赠品、满减、分期、国补条件明显缺失且影响决策。",
    "只有出现限量多少台、库存保证、保价、赠品必送、补贴资格承诺、售后承诺、价格型号明显不匹配、强时效承诺且没有活动条件说明时，才标记“建议人工复核”。",
    "如果发现明确违规证据，也统一输出“建议人工复核”，不要输出“需整改”或“高风险退回”：全网最低、全年最低、最低价、第一、最强、绝对、永久、100%有效、买了必赚、闭眼买、不买后悔一辈子、官方最低、全平台最低、加微信、私信下单、进群领取、站外购买、绕开平台、明显欺骗或虚假宣传。",
    "如果只是常规价格/福利表达，没有明确违规证据，应输出：audit_result 为“通过”，risk_level 为“无”，main_risks 和 hit_rules 为空数组，problem_description 为“未发现明显违规风险”，need_human_review 为 false。",
    "严格输出 JSON 对象，格式为 {\"results\":[...]}，不要输出 Markdown。",
    "results 中每个输入视频必须且只能有一条结果。",
    "每条结果字段：video_id、audit_result、risk_level、main_risks、hit_rules、problem_description、rectification_suggestion、need_human_review。",
    "audit_result 只能是：通过、建议人工复核。",
    "risk_level 只能是：无、低、中、高。",
    "hit_rules 只填写输入 matched_rules 中存在的 rule_id。",
    "无风险时 main_risks 和 hit_rules 返回空数组，need_human_review 返回 false。",
  ].join("\n");
}

function parseModelJson(value) {
  if (value && typeof value === "object") {
    return value;
  }

  const text = clean(value)
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");

  try {
    return JSON.parse(text);
  } catch {
    throw new AiAuditProviderError("AI 模型返回的审核结果无法解析。");
  }
}

function fallbackAuditResult(item) {
  const riskLevel = inferRiskLevel(item.matched_rules);

  return {
    video_id: item.video_id,
    audit_result:
      item.matched_rules.length > 0 ? "建议人工复核" : "通过",
    risk_level: riskLevel,
    main_risks: item.matched_rules.map((rule) => rule.rule_name).filter(Boolean),
    hit_rules: item.matched_rules.map((rule) => rule.rule_id).filter(Boolean),
    problem_description:
      item.matched_rules.length > 0
        ? "模型未返回该视频结果，已保留本地规则命中信息，建议人工复核。"
        : "",
    rectification_suggestion: item.matched_rules
      .map((rule) => rule.rectification)
      .filter(Boolean)
      .join("；"),
    need_human_review: item.matched_rules.length > 0,
    matched_rules: item.matched_rules,
  };
}

function inferRiskLevel(matchedRules) {
  const levels = matchedRules.map((rule) => rule.risk_level);
  if (levels.includes("高")) return "高";
  if (levels.includes("中")) return "中";
  if (levels.includes("低")) return "低";
  return "无";
}

function inferAuditResult(riskLevel, matchedRules) {
  if (riskLevel === "高") return "高风险退回";
  if (matchedRules.length > 0) return "建议人工复核";
  return "通过";
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(clean).filter(Boolean))];
  }

  return clean(value) ? [clean(value)] : [];
}

function normalizeRuleIds(value, matchedRules) {
  const allowed = new Set(matchedRules.map((rule) => rule.rule_id));
  return normalizeStringArray(value).filter((ruleId) => allowed.has(ruleId));
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}
