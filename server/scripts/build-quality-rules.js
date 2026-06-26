import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(currentDirectory, "..");
const sourceDirectory = path.join(serverDirectory, "data", "source");
const outputPath = path.join(
  serverDirectory,
  "data",
  "mile_quality_rules.json",
);
const sourceName = "米乐科技短视频质检规范库_V1";
const preferredFileName = `${sourceName}.xlsx`;
const sourcePath = resolveSourcePath();

const workbook = XLSX.readFile(sourcePath, {
  cellDates: true,
  raw: false,
});
const mainRows = readSheetRows("01_规则主表");
const keywordRows = readSheetRows("02_违规词库");
const rectificationRows = readSheetRows("03_整改建议库");
const caseRows = readSheetRows("04_案例库");

const keywordDictionary = unique(
  keywordRows
    .filter(isActiveRow)
    .flatMap((row) => splitList(read(row, ["风险词/表达", "关键词", "风险词"]))),
);
const rectificationsByRule = groupByRuleId(rectificationRows, [
  "适用规则ID",
  "规则ID",
]);
const casesByRule = groupByRuleId(caseRows, ["命中规则ID", "规则ID"]);

const rules = mainRows
  .filter((row) => {
    const ruleId = read(row, ["规则ID", "规则编号", "ID"]);
    const status = read(row, ["状态"]);
    return ruleId && (!status || status.includes("生效"));
  })
  .map((row) => buildRule(row));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(rules, null, 2)}\n`, "utf8");

console.log(`[quality rules] source: ${sourcePath}`);
console.log(`[quality rules] rules: ${rules.length}`);
console.log(`[quality rules] output: ${outputPath}`);

function buildRule(row) {
  const ruleId = read(row, ["规则ID", "规则编号", "ID"]);
  const ruleName = read(row, ["规则名称", "规则名", "违规类型"]);
  const category = read(row, ["一级分类", "规则分类", "分类"]);
  const subCategory = read(row, ["二级分类", "子分类", "细分类"]);
  const standard = read(row, ["判定标准", "判断标准", "规则内容"]);
  const riskExpressions = read(row, [
    "风险关键词/行为",
    "关键词",
    "风险词",
  ]);
  const typicalCase = read(row, ["典型违规案例", "违规案例", "案例"]);
  const compliantExample = read(row, [
    "合规示例/正确写法",
    "合规示例",
    "正确写法",
  ]);
  const baseRectification = read(row, ["整改要求", "整改建议"]);
  const recommendedChange = read(row, ["推荐改法", "推荐话术/改法"]);
  const relatedRectifications = rectificationsByRule.get(ruleId) ?? [];
  const relatedCases = casesByRule.get(ruleId) ?? [];
  const combinedText = [
    ruleName,
    category,
    subCategory,
    standard,
    riskExpressions,
    typicalCase,
  ].join("\n");
  const keywords = unique([
    ...splitList(riskExpressions),
    ...keywordDictionary.filter((keyword) => combinedText.includes(keyword)),
    ...extractSeedKeywords(combinedText),
  ]);
  const riskReasons = unique([
    ...relatedCases.map((item) =>
      read(item, ["风险说明", "风险原因", "违规原因"]),
    ),
    read(row, ["平台/公司处置参考", "风险原因", "风险说明"]),
  ]);
  const rectifications = unique([
    baseRectification,
    recommendedChange,
    ...relatedRectifications.flatMap((item) => [
      read(item, ["整改要求", "整改建议"]),
      read(item, ["推荐话术/改法", "推荐改法"]),
    ]),
    ...relatedCases.map((item) => read(item, ["建议整改", "整改建议"])),
  ]);
  const examples = unique([
    typicalCase,
    compliantExample,
    ...relatedCases.map((item) =>
      read(item, ["违规表现/原文", "案例", "违规案例"]),
    ),
  ]);

  return {
    rule_id: ruleId,
    rule_name: ruleName,
    category,
    sub_category: subCategory,
    risk_level: read(row, ["风险等级", "风险级别"]),
    keywords,
    standard,
    risk_reason:
      riskReasons.join("；") ||
      `${ruleName || subCategory || category}可能造成内容合规或交易风险。`,
    rectification: rectifications.join("；"),
    examples,
    source: sourceName,
    detection_object: read(row, ["检测对象"]),
    ai_detectability: read(row, ["AI可检测程度"]),
    ai_detection_method: read(row, ["AI检测方式"]),
    manual_review: read(row, ["人工复核要求"]),
    source_url: read(row, ["来源链接"]),
    status: read(row, ["状态"]),
  };
}

function readSheetRows(preferredName) {
  const sheetName =
    workbook.SheetNames.find((name) => name === preferredName) ||
    workbook.SheetNames.find((name) =>
      name.includes(preferredName.replace(/^\d+_/, "")),
    );

  if (!sheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "",
    raw: false,
  });
}

function resolveSourcePath() {
  const preferredPath = path.join(sourceDirectory, preferredFileName);

  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  const xlsxFiles = fs
    .readdirSync(sourceDirectory)
    .filter((name) => name.toLowerCase().endsWith(".xlsx"));

  if (xlsxFiles.length !== 1) {
    throw new Error(
      `未找到 ${preferredFileName}，且 source 目录中的 xlsx 文件数量不是 1。`,
    );
  }

  return path.join(sourceDirectory, xlsxFiles[0]);
}

function groupByRuleId(rows, aliases) {
  const groups = new Map();

  for (const row of rows.filter(isActiveRow)) {
    for (const ruleId of splitRuleIds(read(row, aliases))) {
      const items = groups.get(ruleId) ?? [];
      items.push(row);
      groups.set(ruleId, items);
    }
  }

  return groups;
}

function splitRuleIds(value) {
  return unique(
    clean(value)
      .split(/[;,，；、\s]+/u)
      .map((item) => item.trim())
      .filter((item) => /^ML-/i.test(item)),
  );
}

function splitList(value) {
  return unique(
    clean(value)
      .split(/[;,，；、|/]\s*/u)
      .map((item) => item.trim())
      .filter((item) => item && item.length <= 40),
  );
}

function extractSeedKeywords(text) {
  const seedKeywords = [
    "全网最低",
    "全年最低",
    "最低价",
    "第一",
    "最强",
    "顶级",
    "绝对",
    "永久",
    "100%有效",
    "加微信",
    "私信",
    "站外",
    "进群",
    "到手价",
    "国补",
    "赠品",
    "满减",
    "补贴",
  ];

  return seedKeywords.filter((keyword) => text.includes(keyword));
}

function isActiveRow(row) {
  const status = read(row, ["状态"]);
  return !status || !status.includes("停用");
}

function read(row, aliases) {
  for (const alias of aliases) {
    if (Object.hasOwn(row, alias) && clean(row[alias])) {
      return clean(row[alias]);
    }
  }

  const normalizedAliases = aliases.map(normalizeHeader);

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeHeader(key);

    if (
      normalizedAliases.some(
        (alias) =>
          normalizedKey === alias ||
          normalizedKey.includes(alias) ||
          alias.includes(normalizedKey),
      ) &&
      clean(value)
    ) {
      return clean(value);
    }
  }

  return "";
}

function normalizeHeader(value) {
  return clean(value).replace(/[\s/（）()_-]/gu, "").toLowerCase();
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}
