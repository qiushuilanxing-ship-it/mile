import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const dataDirectory = fileURLToPath(new URL("./data", import.meta.url));
const accountProfilesPath = path.join(dataDirectory, "account_profiles.json");

const fieldDefinitions = {
  secUid: ["账号主页uid", "账号主页 UID", "主页uid", "主页 UID", "secuid", "secUid"],
  business_unit: ["事业部"],
  mode: ["模式"],
  platform: ["平台"],
  erp_name: ["erp名称", "ERP名称", "erp 名称", "ERP 名称"],
  frontend_name: ["前端名称", "店铺名称", "直播间名称"],
  operator: ["运营/编剪", "运营／编剪", "运营编剪", "运营", "编剪"],
  douyin_id: ["抖音号", "抖音账号"],
  door_no: ["门牌", "门牌号"],
  business_status: ["经营状态"],
  live_status: ["直播状态"],
  inspection_range: ["巡检时间范围", "巡检范围"],
  account_match: ["账号匹配", "匹配状态"],
};

const profileFields = Object.keys(fieldDefinitions);

export class AccountProfileImportError extends Error {
  constructor(message, code = "ACCOUNT_PROFILE_IMPORT_FAILED") {
    super(message);
    this.name = "AccountProfileImportError";
    this.code = code;
  }
}

export function parseAccountProfilesWorkbook(buffer, options = {}) {
  let workbook;

  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    throw new AccountProfileImportError(
      "Excel 解析失败，请确认文件未损坏且格式为 .xlsx。",
      "ACCOUNT_PROFILE_EXCEL_INVALID",
    );
  }

  const sheetName = workbook.SheetNames.includes("直播间名称")
    ? "直播间名称"
    : workbook.SheetNames[0];

  if (!sheetName) {
    throw new AccountProfileImportError(
      "Excel 中没有可读取的工作表。",
      "ACCOUNT_PROFILE_SHEET_MISSING",
    );
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });
  const headerIndex = findHeaderRowIndex(rows);

  if (headerIndex < 0) {
    throw new AccountProfileImportError(
      "未识别到 Excel 表头，请确认文件包含“账号主页UID”等字段。",
      "ACCOUNT_PROFILE_HEADER_MISSING",
    );
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const columnMap = buildColumnMap(headers, options.uidColumn);

  if (!Number.isInteger(columnMap.secUid)) {
    throw new AccountProfileImportError(
      "未找到“账号主页UID”列，请检查表头或指定 UID 列。",
      "ACCOUNT_PROFILE_UID_COLUMN_MISSING",
    );
  }

  const uniqueProfiles = new Map();
  let missingUidCount = 0;
  let duplicateUidCount = 0;
  let nonEmptyRowCount = 0;

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    if (!isNonEmptyRow(row)) return;
    nonEmptyRowCount += 1;
    const profile = buildProfile(row, columnMap, headerIndex + offset + 2);

    if (!profile.secUid) {
      missingUidCount += 1;
      return;
    }

    const existing = uniqueProfiles.get(profile.secUid);

    if (!existing) {
      uniqueProfiles.set(profile.secUid, profile);
      return;
    }

    duplicateUidCount += 1;
    if (profileCompleteness(profile) > profileCompleteness(existing)) {
      uniqueProfiles.set(profile.secUid, profile);
    }
  });

  const accounts = [...uniqueProfiles.values()];

  return {
    sheet_name: sheetName,
    header_row: headerIndex + 1,
    total_rows: nonEmptyRowCount,
    imported_count: accounts.length,
    valid_uid_count: accounts.length,
    missing_uid_count: missingUidCount,
    duplicate_uid_count: duplicateUidCount,
    accounts,
  };
}

export function saveAccountProfiles(importResult, sourceFileName = "") {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const payload = {
    imported_at: new Date().toISOString(),
    source_file: sourceFileName,
    stats: {
      imported_count: importResult.imported_count,
      valid_uid_count: importResult.valid_uid_count,
      missing_uid_count: importResult.missing_uid_count,
      duplicate_uid_count: importResult.duplicate_uid_count,
      total_rows: importResult.total_rows,
      sheet_name: importResult.sheet_name,
      header_row: importResult.header_row,
    },
    accounts: importResult.accounts,
  };
  fs.writeFileSync(accountProfilesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function loadAccountProfiles() {
  if (!fs.existsSync(accountProfilesPath)) {
    return {
      imported_at: "",
      source_file: "",
      stats: {
        imported_count: 0,
        valid_uid_count: 0,
        missing_uid_count: 0,
        duplicate_uid_count: 0,
        total_rows: 0,
        sheet_name: "",
        header_row: 0,
      },
      accounts: [],
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(accountProfilesPath, "utf8"));
    return {
      imported_at: cleanValue(payload?.imported_at),
      source_file: cleanValue(payload?.source_file),
      stats: payload?.stats ?? {},
      accounts: Array.isArray(payload?.accounts) ? payload.accounts : [],
    };
  } catch {
    throw new AccountProfileImportError(
      "账号资料库文件读取失败，请重新上传质检名单。",
      "ACCOUNT_PROFILE_STORE_INVALID",
    );
  }
}

export function getAccountProfileMap() {
  return new Map(
    loadAccountProfiles().accounts
      .filter((profile) => profile?.secUid)
      .map((profile) => [String(profile.secUid), profile]),
  );
}

export function pickAccountProfileFields(value = {}) {
  return Object.fromEntries(
    profileFields
      .filter((field) => field !== "secUid")
      .map((field) => [field, cleanValue(value[field])]),
  );
}

function findHeaderRowIndex(rows) {
  let bestIndex = -1;
  let bestScore = 0;

  rows.slice(0, 20).forEach((row, index) => {
    const normalized = row.map(normalizeHeader);
    const score = Object.values(fieldDefinitions).filter((aliases) =>
      aliases.some((alias) => normalized.includes(normalizeHeader(alias))),
    ).length;

    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestScore > 0 ? bestIndex : -1;
}

function buildColumnMap(headers, uidColumn) {
  const columnMap = {};

  for (const [field, aliases] of Object.entries(fieldDefinitions)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const index = headers.findIndex((header) => normalizedAliases.includes(header));
    if (index >= 0) columnMap[field] = index;
  }

  if (!Number.isInteger(columnMap.secUid) && uidColumn !== undefined) {
    const fallbackIndex = resolveFallbackColumn(uidColumn, headers);
    if (fallbackIndex >= 0) columnMap.secUid = fallbackIndex;
  }

  return columnMap;
}

function resolveFallbackColumn(value, headers) {
  const text = cleanValue(value);
  if (!text) return -1;
  const numeric = Number(text);

  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric - 1;
  }

  const upper = text.toUpperCase();
  if (/^[A-Z]+$/u.test(upper)) {
    return upper.split("").reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
  }

  return headers.indexOf(normalizeHeader(text));
}

function buildProfile(row, columnMap, sourceRow) {
  const profile = { secUid: "" };

  for (const field of profileFields) {
    profile[field] = Number.isInteger(columnMap[field])
      ? cleanValue(row[columnMap[field]])
      : "";
  }

  profile.source_row = sourceRow;
  return profile;
}

function profileCompleteness(profile) {
  return profileFields.reduce(
    (score, field) => score + Number(Boolean(cleanValue(profile[field]))),
    0,
  );
}

function isNonEmptyRow(row) {
  return Array.isArray(row) && row.some((value) => cleanValue(value));
}

function normalizeHeader(value) {
  return cleanValue(value)
    .replace(/\s+/gu, "")
    .replace(/[：:]/gu, "")
    .toLowerCase();
}

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}
