const DEFAULT_TIMEOUT_MS = 90_000;
const VALID_AUDIT_RESULTS = new Set([
  "通过",
  "需整改",
  "高风险退回",
  "建议人工复核",
]);
const VALID_RISK_LEVELS = new Set(["无", "低", "中", "高"]);
const AUDIO_MARKERS = [".mp3", ".m4a", ".aac", "ies-music", "music", "audio"];
const VIDEO_MARKERS = [
  "aweme/v1/play",
  "video/tos",
  "douyinvod.com",
  "zjcdn.com",
  ".mp4",
  "mime_type=video",
];
const MODEL_TEMPERATURE = 0;
const MODEL_TOP_P = 0.1;

const CONSISTENCY_GUIDANCE = `【一致性要求】
对于同类商品、相似标题、相似字幕、相似画面、相同规则命中的视频，必须保持一致的审核标准。
不要因为轻微措辞差异，就给出完全相反的结论。
如果判断为风险或需要人工审核，必须指出明确证据。
不要只输出泛泛的风险描述，例如“可能虚假宣传”“可能误导消费者”“可能夸大功效”“可能存在违规风险”。
如果没有明确证据，应降低结论强度。
输出必须包含 evidence_points 数组；每个证据点包含 source、text、reason。source 只能使用 title、ocr、desc、frame、rule、account。`;

const PRICE_ACTIVITY_GUIDANCE = `价格/活动类内容判定尺度：
1. 直播间价格、到手价、国补、福利、活动价、惊喜福利、下单福利、优惠活动等表述，本身不等于违规。
2. 如果内容只是引导用户到直播间查看活动，例如“直播间福利大放送”“直播间国补到手4419”“下单还有惊喜福利”“价格4XXX”“到手价很香”“进直播间看看”，默认判定为“通过”，risk_level 必须为“无”，need_human_review 必须为 false。
3. 常规价格/福利表达可以在 rectification_suggestion 中轻微提示“发布前由运营确认活动价格与后台一致即可”，但不要因此输出“建议人工复核”。
4. 只有出现明确但不完整且容易误导消费者的强价格承诺，才标记“建议人工复核”：例如具体到手价但商品型号、规格、活动条件完全无法判断；多个价格前后冲突；标题价格与画面价格明显不一致；赠品、满减、分期、国补条件明显缺失且影响决策。
5. 只有出现需要后台确认的具体强承诺时，才标记“建议人工复核”：例如限量多少台、库存保证、保价、赠品必送、补贴资格承诺、售后承诺。
6. 如果价格信息与商品型号明显不匹配，或出现“仅限今天”“最后一波”“错过不再有”等强时效承诺且没有任何活动条件说明，标记“建议人工复核”。
7. 发现明确违规证据时也统一输出“建议人工复核”，不要输出“需整改”或“高风险退回”：例如全网最低、全年最低、最低价、第一、最强、绝对、永久、100%有效、买了必赚、闭眼买、不买后悔一辈子、官方最低、全平台最低、加微信、私信下单、进群领取、站外购买、绕开平台、明显欺骗或虚假宣传。
8. 如果只是常规价格/福利表达，没有明确违规证据，请输出：audit_result 为“通过”，risk_level 为“无”，main_risks 和 hit_rules 为空数组，problem_description 为“未发现明显违规风险”，need_human_review 为 false；evidence 说明未发现极限词、站外导流、明显虚假宣传或价格冲突；visual_evidence 可说明画面展示直播间活动价格或福利信息，属于常规活动引导；rectification_suggestion 写“无需整改，发布前由运营确认活动价格、国补政策与后台一致即可”。`;

const VISION_SYSTEM_PROMPT = `你是“米乐科技短视频视觉质检员”，负责根据米乐科技短视频质检规范，对抖音短视频进行合规初审。

你会收到：
1. 视频画面内容；
2. 视频标题/描述 desc；
3. 发布时间；
4. 视频链接；
5. 本地规则库命中的候选规则。

你的任务不是评价内容创意好不好，而是判断视频是否存在平台违规、误导消费者、审核不过、投诉、下架或需要人工复核的风险。

重点检查：
1. 视频画面中是否出现极限词、绝对化表达，如全网最低、全年最低、第一、最强、顶级、绝对、永久、100%有效等。
2. 视频画面、字幕、贴片、标题描述中是否存在虚假宣传、夸大功效、承诺效果、虚构优惠、虚构数据、无法证明的卖点。
3. 画面中是否出现价格、补贴、国补、赠品、满减、活动规则等信息；常规活动引导不是风险，只有价格冲突、强承诺、规则严重缺失或明确违规时才判风险。
4. 商品品牌、型号、参数、价格、活动信息是否疑似错误，或与标题描述不一致。
5. 是否存在诱导第三方交易，如加微信、私信、进群、站外下单、绕开平台交易等。
6. 是否存在水印、搬运痕迹、第三方平台标识、素材侵权风险。
7. 画面是否低清、严重遮挡、贴片遮挡商品或人物、影响消费者理解。
8. 是否存在低俗、暴力、危险动作、未成年人不当内容。
9. 是否存在 AI 生成画面、数字人、虚拟场景但未标注，或可能误导消费者的 AI 商品场景。

审核原则：
1. 必须基于视频画面、字幕、贴片、标题描述中的明确证据判断。
2. 不要脑补没有看到的信息。
3. 没有明确风险时输出“通过”，不要硬找问题。
4. 不要因为出现直播间价格、到手价、国补、福利、活动价等常见电商活动信息，就自动输出“建议人工复核”。
5. 需要整改时，必须给出具体整改建议。
6. evidence 必须引用标题描述或视频画面中看到的具体内容。
7. hit_rules 优先填写 matchedRules 中存在的 rule_id 或 rule_name；如果没有命中规则但存在明显基础风险，可以写“基础合规规则”。
8. 只输出严格 JSON，不要输出 Markdown，不要输出代码块，不要输出解释。

${PRICE_ACTIVITY_GUIDANCE}
${CONSISTENCY_GUIDANCE}`;

const TEXT_SYSTEM_PROMPT = `你是米乐科技短视频文本质检员。当前无法审核视频画面，只能根据标题描述和本地候选规则进行合规初审。

matched_rules 是本地关键词初筛候选，不代表一定违规；必须结合标题描述上下文综合判断。
没有明确风险时输出“通过”，不要硬找问题。不要因为出现直播间价格、到手价、国补、福利、活动价等常见电商活动信息，就自动输出“建议人工复核”。

${PRICE_ACTIVITY_GUIDANCE}
${CONSISTENCY_GUIDANCE}

只输出严格 JSON。`;

export class LLMConfigurationError extends Error {}
export class LLMProviderError extends Error {}

export function isValidVideoUrl(value) {
  const url = clean(value);

  if (!url || !/^https?:\/\//iu.test(url)) {
    return false;
  }

  const normalized = url.toLowerCase();

  if (AUDIO_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }

  return VIDEO_MARKERS.some((marker) => normalized.includes(marker));
}

export async function auditVideoWithVision(
  video,
  matchedRules,
  options = {},
) {
  if (!isValidVideoUrl(video?.play_url)) {
    throw new LLMProviderError("play_url 不是可识别的视频链接。");
  }

  const userPrompt = buildVisionAuditPrompt(video, matchedRules);
  const visionTimeoutMs =
    options.timeoutMs ??
    resolveTimeout(process.env.AI_VISION_TIMEOUT_MS, 180_000);
  return callAuditModel({
    ...options,
    timeoutMs: visionTimeoutMs,
    video,
    matchedRules,
    userPrompt,
    systemPrompt: VISION_SYSTEM_PROMPT,
    videoUrl: clean(video.play_url),
    userContent: [
      {
        type: "video_url",
        video_url: {
          url: clean(video.play_url),
          fps: 2,
        },
      },
      {
        type: "text",
        text: userPrompt,
      },
    ],
    auditMode: "video",
    visualStatus: "success",
  });
}

export async function auditVideoWithText(video, matchedRules, options = {}) {
  const userPrompt = buildTextAuditPrompt(video, matchedRules);
  const textTimeoutMs =
    options.timeoutMs ?? resolveTimeout(process.env.AI_TIMEOUT_MS);
  return callAuditModel({
    ...options,
    timeoutMs: textTimeoutMs,
    video,
    matchedRules,
    userPrompt,
    systemPrompt: TEXT_SYSTEM_PROMPT,
    videoUrl: "",
    userContent: userPrompt,
    auditMode: options.auditMode ?? "text",
    visualStatus: options.visualStatus ?? "no_video_url",
    visualError: options.visualError ?? "",
  });
}

// Kept as a compatibility alias for existing callers.
export async function auditVideoWithLLM(video, matchedRules, options = {}) {
  return auditVideoWithText(video, matchedRules, options);
}

async function callAuditModel({
  video,
  matchedRules,
  userPrompt,
  systemPrompt,
  userContent,
  videoUrl = "",
  imageUrl = "",
  auditMode,
  visualStatus,
  visualError = "",
  fetchImpl = fetch,
  baseUrl = process.env.AI_BASE_URL?.trim(),
  apiKey = process.env.AI_API_KEY?.trim(),
  model = process.env.AI_MODEL?.trim(),
  apiType = normalizeApiType(process.env.AI_API_TYPE),
  timeoutMs = resolveTimeout(process.env.AI_TIMEOUT_MS),
  includeDebug = false,
}) {
  if (!baseUrl || !apiKey || !model) {
    throw new LLMConfigurationError(
      "AI 质检模型尚未配置，请设置 AI_BASE_URL、AI_API_KEY 和 AI_MODEL。",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const providerResult =
      apiType === "responses"
        ? await callArkResponses({
            systemPrompt,
            userText: userPrompt,
            videoUrl,
            imageUrl,
            fetchImpl,
            baseUrl,
            apiKey,
            model,
            signal: controller.signal,
          })
        : await callArkChatCompletions({
            systemPrompt,
            userContent,
            fetchImpl,
            baseUrl,
            apiKey,
            model,
            signal: controller.signal,
          });
    const { responseData, content } = providerResult;
    const parsedResult = extractJson(content);
    const formatInvalid = !parsedResult;
    const result = parsedResult
      ? normalizeAuditResult(parsedResult, video, matchedRules)
      : createFormatFallback(video);

    return attachMetadata(result, {
      auditMode: formatInvalid ? "text_fallback" : auditMode,
      visualStatus: formatInvalid ? "failed" : visualStatus,
      visualError: formatInvalid ? "AI 返回格式异常" : visualError,
      includeDebug,
      video,
      matchedRules,
      userPrompt,
      rawResponse: responseData,
      model,
      apiType,
    });
  } catch (error) {
    error.model_used ??= model;
    error.api_type ??= apiType;
    error.detail ??= error.message;

    if (includeDebug) {
      error.auditDebug = createAuditDebugDetails({
        video,
        matchedRules,
        userPrompt,
        rawResponse: error.raw ?? {
          error: error.message,
          status: error.status ?? null,
        },
        model,
        apiType,
        auditMode,
        visualStatus,
        visualError,
      });
    }

    if (error instanceof LLMProviderError) {
      throw error;
    }

    if (error.name === "AbortError") {
      const timeoutError = new LLMProviderError("火山方舟 AI 质检请求超时。");
      timeoutError.status = 408;
      timeoutError.detail = error.message;
      timeoutError.model_used = model;
      timeoutError.api_type = apiType;
      timeoutError.auditDebug = error.auditDebug;
      throw timeoutError;
    }

    const providerError = new LLMProviderError(
      error.message || "火山方舟 AI 质检请求失败。",
    );
    providerError.cause = error;
    providerError.status = error.status;
    providerError.detail = error.detail || error.message;
    providerError.model_used = model;
    providerError.api_type = apiType;
    providerError.auditDebug = error.auditDebug;
    throw providerError;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callArkResponses({
  systemPrompt,
  userText,
  videoUrl = "",
  imageUrl = "",
  fetchImpl = fetch,
  baseUrl = process.env.AI_BASE_URL?.trim(),
  apiKey = process.env.AI_API_KEY?.trim(),
  model = process.env.AI_MODEL?.trim(),
  signal,
}) {
  const contentItems = [];

  if (videoUrl) {
    contentItems.push({
      type: "input_video",
      video_url: videoUrl,
    });
  }
  if (imageUrl) {
    contentItems.push({
      type: "input_image",
      image_url: imageUrl,
    });
  }
  contentItems.push({
    type: "input_text",
    text: userText,
  });

  const response = await fetchImpl(
    `${baseUrl.replace(/\/+$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: contentItems,
          },
        ],
        temperature: MODEL_TEMPERATURE,
        top_p: MODEL_TOP_P,
      }),
      signal,
    },
  );
  const responseText = await response.text();
  let responseData;

  try {
    responseData = parseProviderResponse(responseText);
  } catch (parseError) {
    if (response.ok) throw parseError;
    responseData = null;
  }

  if (!response.ok) {
    console.error("[Ark Responses] status:", response.status);
    console.error("[Ark Responses] body:", responseText);
    throw createProviderHttpError({
      response,
      responseData,
      responseText,
      model,
      apiType: "responses",
    });
  }

  return {
    responseData,
    content: extractResponsesText(responseData),
  };
}

async function callArkChatCompletions({
  systemPrompt,
  userContent,
  fetchImpl,
  baseUrl,
  apiKey,
  model,
  signal,
}) {
  const response = await fetchImpl(
    `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: MODEL_TEMPERATURE,
        top_p: MODEL_TOP_P,
        max_tokens: 1600,
      }),
      signal,
    },
  );
  const responseText = await response.text();
  const responseData = parseProviderResponse(responseText);

  if (!response.ok) {
    throw createProviderHttpError({
      response,
      responseData,
      responseText,
      model,
      apiType: "chat_completions",
    });
  }

  return {
    responseData,
    content: responseData?.choices?.[0]?.message?.content,
  };
}

export function extractResponsesText(data) {
  if (clean(data?.output_text)) {
    return clean(data.output_text);
  }

  const texts = [];
  for (const outputItem of Array.isArray(data?.output) ? data.output : []) {
    if (clean(outputItem?.text)) texts.push(clean(outputItem.text));

    for (const contentItem of Array.isArray(outputItem?.content)
      ? outputItem.content
      : []) {
      if (
        ["output_text", "text"].includes(contentItem?.type) &&
        clean(contentItem?.text)
      ) {
        texts.push(clean(contentItem.text));
      }
    }
  }

  if (texts.length > 0) {
    return texts.join("\n");
  }

  throw new LLMProviderError("无法解析 Responses API 返回文本");
}

export function buildVisionAuditPrompt(video, matchedRules) {
  const matchedKeywords = collectMatchedKeywords(matchedRules);
  const companyRuleText = formatCompanyRules(matchedRules);

  return `【视频信息】
视频ID：${clean(video?.video_id)}
账号名称：${clean(video?.author_name)}
发布时间：${clean(video?.create_time)}
视频链接：${clean(video?.page_url)}

【视频标题/描述】
${clean(video?.desc) || "（无标题描述）"}

【本地规则库初筛结果】
命中关键词：${matchedKeywords.length > 0 ? matchedKeywords.join("、") : "无"}
命中规则：${JSON.stringify(Array.isArray(matchedRules) ? matchedRules : [])}

${companyRuleText}
${formatUnifiedVideoContext(video)}

【审核要求】
请结合视频画面、字幕、贴片、商品展示、标题描述和命中规则进行合规初审。
请重点判断是否存在虚假宣传、极限词、价格活动风险、商品信息错误、诱导第三方交易、水印侵权、低俗暴力、AI内容未标注等问题。
特别注意：国补、到手价、直播间福利、惊喜福利、下单福利、价格 4XXX、618/促销/活动价等常规电商活动表达，本身不等于违规。没有极限词、站外导流、价格冲突、强承诺或明显规则缺失时，应判“通过”，need_human_review=false。
示例：画面“RedMi X85 2026 直播间国补到手4419”，标题“现在下单还有惊喜福利，快来看看吧”，应判“通过”，risk_level 为“无”，problem_description 为“未发现明显违规风险”，need_human_review=false，建议写“无需整改，发布前由运营确认活动价格、国补政策与后台一致即可”。
如果发现明显违规、价格冲突、站外导流、极限词、虚假宣传、规则明显缺失等问题，统一输出 audit_result 为“建议人工复核”，need_human_review=true；不要输出“需整改”或“高风险退回”。
请只输出严格 JSON。

输出字段：
{"video_id":"","source_video_id":"","audit_result":"通过/建议人工复核","risk_level":"无/低/中/高","main_risks":[],"hit_rules":[],"matched_rule_ids":[],"matched_rule_titles":[],"evidence":"","visual_evidence":"","evidence_points":[{"source":"title/ocr/desc/frame/rule/account","text":"","reason":""}],"problem_description":"","rectification_suggestion":"","need_human_review":true,"audit_mode":"video"}`;
}

export function buildTextAuditPrompt(video, matchedRules) {
  const matchedKeywords = collectMatchedKeywords(matchedRules);
  const companyRuleText = formatCompanyRules(matchedRules);

  return `请对下面这条抖音视频进行文本降级质检。当前无法读取视频画面，不要推测画面内容。

【视频信息】
视频ID：${clean(video?.video_id)}
账号名称：${clean(video?.author_name)}
发布时间：${clean(video?.create_time)}
视频链接：${clean(video?.page_url)}

【视频标题/描述】
${clean(video?.desc) || "（无标题描述）"}

【本地规则库初筛结果】
命中关键词：${matchedKeywords.length > 0 ? matchedKeywords.join("、") : "无"}
命中规则：${JSON.stringify(Array.isArray(matchedRules) ? matchedRules : [])}

${companyRuleText}
${formatUnifiedVideoContext(video)}

仅根据标题描述和候选规则判断。没有明确风险时输出“通过”；不要因为出现国补、到手价、直播间福利、惊喜福利、下单福利、价格 4XXX、618/促销/活动价等常规电商活动表达，就自动输出“建议人工复核”。
只有出现明确价格冲突、强价格承诺、强时效承诺、站外导流、极限词、明显虚假宣传或严重规则缺失时，才输出“建议人工复核”，不要输出“需整改”或“高风险退回”。
示例：标题包含“直播间国补到手4419”“下单还有惊喜福利”“进直播间看看”，若没有其他违规证据，应判“通过”，risk_level 必须为“无”，need_human_review=false。
只输出严格 JSON：
{"video_id":"","source_video_id":"","audit_result":"通过/建议人工复核","risk_level":"无/低/中/高","main_risks":[],"hit_rules":[],"matched_rule_ids":[],"matched_rule_titles":[],"evidence":"","visual_evidence":"","evidence_points":[{"source":"title/ocr/desc/frame/rule/account","text":"","reason":""}],"problem_description":"","rectification_suggestion":"","need_human_review":true,"audit_mode":"text"}`;
}

export const buildAuditPrompt = buildTextAuditPrompt;

function formatUnifiedVideoContext(video) {
  return `【统一上下文】
source_video_id：${clean(video?.source_video_id || video?.video_id)}
stable_id：${clean(video?.stable_id || video?.video_id)}
账号名称：${clean(video?.author_name)}
前端名称：${clean(video?.frontend_name)}
ERP名称：${clean(video?.erp_name)}
运营/编剪：${clean(video?.operator)}
抖音号：${clean(video?.douyin_id)}
封面图：${clean(video?.cover_url)}
播放链接：${clean(video?.play_url)}
OCR字幕/画面文字：${clean(video?.ocr_text || video?.subtitle_text) || "无"}
normalized_content_key：${clean(video?.normalized_content_key)}
请把 source_video_id 原样带回输出。`;
}

function formatCompanyRules(matchedRules) {
  const rules = (Array.isArray(matchedRules) ? matchedRules : [])
    .filter((rule) => rule?.source === "audit_rules" || rule?.decision)
    .slice(0, 10);

  if (rules.length === 0) {
    return `【公司质检规则库】
当前未命中公司自定义规则。`;
  }

  return `【公司质检规则库】
以下是当前公司启用的审核规则，必须优先参考：

${rules
  .map(
    (rule, index) => `${index + 1}. 规则名称：${clean(rule.rule_name)}
   规则ID：${clean(rule.rule_id)}
   分类：${clean(rule.category) || "未分类"}
   关键词：${
     Array.isArray(rule.keywords) && rule.keywords.length > 0
       ? rule.keywords.join("、")
       : Array.isArray(rule.matched_keywords) && rule.matched_keywords.length > 0
         ? rule.matched_keywords.join("、")
         : "无"
   }
   规则说明：${clean(rule.standard) || "无"}
   处理建议：${clean(rule.decision || rule.rectification) || "建议人工审核"}`,
  )
  .join("\n\n")}`;
}

function parseProviderResponse(responseText) {
  if (!responseText) return null;

  try {
    return JSON.parse(responseText);
  } catch {
    throw new LLMProviderError("火山方舟返回内容不是有效 JSON。");
  }
}

function createProviderHttpError({
  response,
  responseData,
  responseText,
  model,
  apiType,
}) {
  const detail =
    responseData?.error?.message ||
    responseData?.message ||
    responseData?.detail ||
    responseText ||
    `HTTP ${response.status}`;
  const error = new LLMProviderError(
    `火山方舟请求失败，HTTP ${response.status}：${clean(detail)}`,
  );
  error.status = response.status;
  error.detail = clean(detail);
  error.raw = responseData ?? responseText;
  error.model_used = model;
  error.api_type = apiType;

  if (isModelLimitError(detail)) {
    error.code = "AI_MODEL_LIMIT_REACHED";
  }

  return error;
}

function extractJson(content) {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return content;
  }

  const text = clean(content);
  if (!text) return null;

  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""),
    extractObjectText(text),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try another JSON fragment.
    }
  }

  return null;
}

function extractObjectText(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function normalizeAuditResult(result, video, matchedRules) {
  const allowedRules = new Set(["基础合规规则"]);
  const ruleMetaById = new Map();
  const ruleMetaByTitle = new Map();

  for (const rule of Array.isArray(matchedRules) ? matchedRules : []) {
    const ruleId = clean(rule?.rule_id);
    const ruleTitle = clean(rule?.rule_name);
    const meta = {
      id: ruleId,
      title: ruleTitle,
      category: clean(rule?.category),
    };
    if (ruleId) {
      allowedRules.add(ruleId);
      ruleMetaById.set(ruleId, meta);
    }
    if (ruleTitle) {
      allowedRules.add(ruleTitle);
      ruleMetaByTitle.set(ruleTitle, meta);
    }
  }

  const riskLevel = VALID_RISK_LEVELS.has(result.risk_level)
    ? result.risk_level
    : "低";
  const auditResult = VALID_AUDIT_RESULTS.has(result.audit_result)
    ? result.audit_result
    : "建议人工复核";

  const hitRules = normalizeStringArray(result.hit_rules).filter((rule) =>
    allowedRules.has(rule),
  );
  const explicitRuleIds = normalizeStringArray(result.matched_rule_ids).filter(
    (ruleId) => ruleMetaById.has(ruleId),
  );
  const explicitRuleTitles = normalizeStringArray(
    result.matched_rule_titles,
  ).filter((title) => ruleMetaByTitle.has(title));
  const inferredRuleMetas = [
    ...(Array.isArray(matchedRules) ? matchedRules : [])
      .filter(
        (rule) =>
          rule?.source === "audit_rules" &&
          Array.isArray(rule.matched_keywords) &&
          rule.matched_keywords.length > 0,
      )
      .map((rule) => ruleMetaById.get(clean(rule.rule_id)))
      .filter(Boolean),
    ...explicitRuleIds.map((ruleId) => ruleMetaById.get(ruleId)),
    ...explicitRuleTitles.map((title) => ruleMetaByTitle.get(title)),
    ...hitRules
      .map((rule) => ruleMetaById.get(rule) || ruleMetaByTitle.get(rule))
      .filter(Boolean),
  ].filter(Boolean);
  const uniqueRuleMetas = dedupeRuleMetas(inferredRuleMetas);

  return {
    video_id: clean(video?.video_id),
    source_video_id: clean(
      result.source_video_id || video?.source_video_id || video?.video_id,
    ),
    audit_result: auditResult,
    risk_level: riskLevel,
    main_risks: normalizeStringArray(result.main_risks),
    hit_rules: hitRules,
    matched_rule_ids: uniqueRuleMetas.map((rule) => rule.id).filter(Boolean),
    matched_rule_titles: uniqueRuleMetas
      .map((rule) => rule.title)
      .filter(Boolean),
    matched_rule_categories: [
      ...new Set(uniqueRuleMetas.map((rule) => rule.category).filter(Boolean)),
    ],
    evidence: clean(result.evidence),
    visual_evidence: clean(result.visual_evidence),
    evidence_points: normalizeEvidencePoints(result.evidence_points),
    problem_description: clean(result.problem_description),
    rectification_suggestion: clean(result.rectification_suggestion),
    need_human_review:
      typeof result.need_human_review === "boolean"
        ? result.need_human_review
        : auditResult !== "通过",
  };
}

function dedupeRuleMetas(rules) {
  const seen = new Set();
  const result = [];

  for (const rule of rules) {
    const key = rule?.id || rule?.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(rule);
  }

  return result;
}

function createFormatFallback(video) {
  return {
    video_id: clean(video?.video_id),
    source_video_id: clean(video?.source_video_id || video?.video_id),
    audit_result: "建议人工复核",
    risk_level: "低",
    main_risks: ["AI返回格式异常"],
    hit_rules: [],
    matched_rule_ids: [],
    matched_rule_titles: [],
    matched_rule_categories: [],
    evidence: "",
    visual_evidence: "",
    evidence_points: [],
    problem_description: "大模型未返回有效 JSON",
    rectification_suggestion: "建议人工查看该视频",
    need_human_review: true,
  };
}

export function createProviderFallback(video, error, metadata = {}) {
  const reason = /超时|timeout/iu.test(clean(error?.message))
    ? "AI 质检请求超时"
    : "AI 质检服务暂时不可用";

  return {
    video_id: clean(video?.video_id),
    source_video_id: clean(video?.source_video_id || video?.video_id),
    audit_result: "建议人工复核",
    risk_level: "低",
    main_risks: [reason],
    hit_rules: [],
    matched_rule_ids: [],
    matched_rule_titles: [],
    matched_rule_categories: [],
    evidence: "",
    visual_evidence: "",
    evidence_points: [],
    problem_description: `${reason}，该条视频未完成自动质检`,
    rectification_suggestion: "建议稍后重新质检，或人工查看该视频",
    need_human_review: true,
    audit_mode: metadata.auditMode ?? "text_fallback",
    visual_status: metadata.visualStatus ?? "failed",
    visual_error: clean(metadata.visualError ?? error?.message),
    status: error?.status ?? null,
    detail: clean(error?.detail ?? error?.message),
    model_used: clean(metadata.model ?? error?.model_used),
    api_type: normalizeApiType(metadata.apiType ?? error?.api_type),
    ...(error?.code ? { code: error.code } : {}),
  };
}

export function createAuditDebugDetails({
  video,
  matchedRules,
  userPrompt,
  rawResponse,
  model,
  apiType,
  auditMode,
  visualStatus,
  visualError,
}) {
  const normalizedRules = (Array.isArray(matchedRules) ? matchedRules : []).map(
    (rule) => ({
      rule_id: clean(rule?.rule_id),
      category: clean(rule?.category),
      standard: clean(rule?.standard),
      rectification: clean(rule?.rectification),
      matched_keywords: normalizeStringArray(rule?.matched_keywords),
    }),
  );

  return {
    desc: clean(video?.desc),
    matched_keywords: collectMatchedKeywords(normalizedRules),
    matched_rules: normalizedRules,
    user_prompt: clean(userPrompt),
    raw_response: rawResponse ?? null,
    model_used: clean(model),
    api_type: normalizeApiType(apiType),
    audit_mode: clean(auditMode),
    visual_status: clean(visualStatus),
    visual_error: clean(visualError),
  };
}

function attachMetadata(
  result,
  {
    auditMode,
    visualStatus,
    visualError,
    includeDebug,
    video,
    matchedRules,
    userPrompt,
    rawResponse,
    model,
    apiType,
  },
) {
  const enriched = {
    ...result,
    need_human_review:
      auditMode === "text_fallback" ? true : result.need_human_review,
    audit_mode: auditMode,
    visual_status: visualStatus,
    visual_error: clean(visualError),
    model_used: clean(model),
    api_type: normalizeApiType(apiType),
  };

  if (!includeDebug) return enriched;

  return {
    ...enriched,
    debug: createAuditDebugDetails({
      video,
      matchedRules,
      userPrompt,
      rawResponse,
      model,
      apiType,
      auditMode,
      visualStatus,
      visualError,
    }),
  };
}

function collectMatchedKeywords(matchedRules) {
  return [
    ...new Set(
      (Array.isArray(matchedRules) ? matchedRules : [])
        .flatMap((rule) => normalizeStringArray(rule?.matched_keywords))
        .filter(Boolean),
    ),
  ];
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return clean(value) ? [clean(value)] : [];
  }

  return [...new Set(value.map(clean).filter(Boolean))];
}

function normalizeEvidencePoints(value) {
  if (!Array.isArray(value)) return [];
  const allowedSources = new Set(["title", "ocr", "desc", "frame", "rule", "account"]);

  return value
    .map((point) => ({
      source: allowedSources.has(clean(point?.source).toLowerCase())
        ? clean(point.source).toLowerCase()
        : "desc",
      text: clean(point?.text).slice(0, 500),
      reason: clean(point?.reason).slice(0, 500),
    }))
    .filter((point) => point.text || point.reason)
    .slice(0, 8);
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function resolveTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  const timeout = Number(value);
  return Number.isInteger(timeout) && timeout >= 10_000 && timeout <= 180_000
    ? timeout
    : fallback;
}

function normalizeApiType(value) {
  return clean(value).toLowerCase() === "responses"
    ? "responses"
    : "chat_completions";
}

function isModelLimitError(value) {
  return /safe experience mode|inference limit|rate.?limit|quota|额度|限额|模型调用次数/iu.test(
    clean(value),
  );
}
