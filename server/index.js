import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import {
  authenticateUser,
  createSession,
  deleteAuditRun,
  deleteSession,
  getAdminDashboard,
  getAuditRun,
  getGenerationByRequestId,
  getLatestAuditRun,
  getPersonalDashboard,
  getUsageStats,
  getUserBySessionToken,
  listAuditRuns,
  listAiLogs,
  listUsers,
  recordGeneration,
  upsertAuditRun,
  updateUserPassword,
  upsertUser,
} from "./database.js";
import {
  finalizeGenerationResult,
  GenerationEngineInputError,
  prepareGenerationRequest,
} from "./generation-engine.js";
import {
  processInSequentialBatches,
  summarizeAuditResults,
  withTimeout,
} from "./audit-batches.js";
import {
  AccountProfileImportError,
  getAccountProfileMap,
  loadAccountProfiles,
  parseAccountProfilesWorkbook,
  pickAccountProfileFields,
  saveAccountProfiles,
} from "./account-profiles.js";
import {
  buildDouyinVideos,
  DouyinCrawlerError,
  DouyinRangeError,
  extractDouyinAwemeList,
  getCreateTimeSeconds,
  normalizeAccountTaskRangeType,
  normalizeSecUid,
  resolveAccountTaskRangeInput,
  resolveDouyinRange,
} from "./douyin-audit.js";
import {
  AiAuditConfigurationError,
  AiAuditInputError,
  buildAuditItems,
  loadQualityRules,
  prepareAuditVideos,
} from "./douyin-ai-audit.js";
import {
  auditVideoWithText,
  auditVideoWithVision,
  buildTextAuditPrompt,
  createAuditDebugDetails,
  createProviderFallback,
  isValidVideoUrl,
  LLMConfigurationError,
  LLMProviderError,
} from "./services/llmClient.js";
import {
  extractWorkflowResultWithFallback,
  isEmptyWorkflowResult,
} from "./coze-stream.js";
import { logError, logInfo } from "./logger.js";
import { acquireUserRequest } from "./request-guard.js";

dotenv.config({
  path: fileURLToPath(new URL("./.env", import.meta.url)),
});

const app = express();
const port = Number(process.env.PORT) || 3001;
const CRAWLER_BASE_URL = (
  process.env.CRAWLER_BASE_URL || "http://127.0.0.1:8080"
).replace(/\/+$/, "");
const maxVideoSize = 100 * 1024 * 1024;
const maxImageSize = 20 * 1024 * 1024;
const configuredMaxImageCount = Number(process.env.MAX_IMAGE_COUNT);
const maxImageCount =
  Number.isInteger(configuredMaxImageCount) && configuredMaxImageCount > 0
    ? configuredMaxImageCount
    : 10;
logAiConfiguration();
const acceptedVideoTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
]);
const acceptedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxVideoSize,
    files: maxImageCount + 2,
  },
  fileFilter(_request, file, callback) {
    const isImage =
      ["images", "image_file"].includes(file.fieldname) &&
      acceptedImageTypes.has(file.mimetype);
    const isVideo =
      file.fieldname === "video_file" && acceptedVideoTypes.has(file.mimetype);

    if (!isImage && !isVideo) {
      return callback(new Error("UNSUPPORTED_MEDIA_TYPE"));
    }

    return callback(null, true);
  },
});
const accountListUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter(_request, file, callback) {
    const isXlsx = file.originalname.toLowerCase().endsWith(".xlsx");

    return isXlsx
      ? callback(null, true)
      : callback(new Error("ACCOUNT_LIST_XLSX_REQUIRED"));
  },
});

app.use((request, response, next) => {
  const clientRequestId = request.get("X-Request-Id")?.trim();
  request.requestId =
    clientRequestId && clientRequestId.length <= 100
      ? clientRequestId
      : crypto.randomUUID();
  response.setHeader("X-Request-Id", request.requestId);
  next();
});
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_request, response) => {
  return sendSuccess(response, { ok: true });
});

app.post("/api/login", handleLogin);
app.post("/api/auth/login", handleLogin);
app.post("/api/logout", handleLogout);
app.post("/api/auth/logout", handleLogout);
app.get("/api/me", handleMe);
app.get("/api/auth/me", handleMe);

app.use("/api", requireAuth);

app.post("/api/audit/account-list/import", (request, response) => {
  accountListUpload.single("file")(request, response, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError) {
        const message =
          uploadError.code === "LIMIT_FILE_SIZE"
            ? "质检名单不能超过 10MB。"
            : "质检名单上传失败，请重新选择文件。";
        return sendFailure(
          response,
          uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400,
          message,
          "ACCOUNT_PROFILE_UPLOAD_FAILED",
        );
      }

      return sendFailure(
        response,
        400,
        uploadError.message === "ACCOUNT_LIST_XLSX_REQUIRED"
          ? "质检名单仅支持 .xlsx 文件。"
          : "质检名单上传失败，请重新选择文件。",
        "ACCOUNT_PROFILE_UPLOAD_FAILED",
      );
    }

    if (!request.file) {
      return sendFailure(
        response,
        400,
        "请选择要上传的质检名单 Excel。",
        "ACCOUNT_PROFILE_FILE_REQUIRED",
      );
    }

    try {
      const sourceFileName = normalizeUploadFileName(request.file.originalname);
      const importResult = parseAccountProfilesWorkbook(request.file.buffer, {
        uidColumn: request.body?.uidColumn,
      });
      const saved = saveAccountProfiles(
        importResult,
        sourceFileName,
      );
      logInfo("douyin.account_profiles.imported", {
        ...requestContext(request),
        source_file: sourceFileName,
        imported_count: importResult.imported_count,
        missing_uid_count: importResult.missing_uid_count,
        duplicate_uid_count: importResult.duplicate_uid_count,
      });
      return sendSuccess(response, {
        count: saved.accounts.length,
        accounts: saved.accounts,
        imported_at: saved.imported_at,
        source_file: saved.source_file,
        stats: saved.stats,
      });
    } catch (error) {
      const isImportError = error instanceof AccountProfileImportError;
      logError("douyin.account_profiles.import_failed", error, {
        ...requestContext(request),
        source_file: normalizeUploadFileName(request.file.originalname),
      });
      return sendFailure(
        response,
        isImportError ? 400 : 500,
        isImportError
          ? error.message
          : "质检名单解析失败，请检查 Excel 内容后重试。",
        error.code ?? "ACCOUNT_PROFILE_IMPORT_FAILED",
      );
    }
  });
});

app.get("/api/audit/account-list", (request, response) => {
  try {
    const store = loadAccountProfiles();
    return sendSuccess(response, {
      count: store.accounts.length,
      accounts: store.accounts,
      imported_at: store.imported_at,
      source_file: store.source_file,
      stats: store.stats,
    });
  } catch (error) {
    logError("douyin.account_profiles.read_failed", error, requestContext(request));
    return sendFailure(
      response,
      500,
      error.message || "账号资料库读取失败，请重新上传质检名单。",
      error.code ?? "ACCOUNT_PROFILE_READ_FAILED",
    );
  }
});

app.post("/api/audit/runs", (request, response) => {
  try {
    const currentUser = getCurrentUser(request);

    if (!currentUser) {
      return sendFailure(
        response,
        401,
        "请先登录后再保存质检记录",
        "AUTH_REQUIRED",
      );
    }

    const run = upsertAuditRun({
      id: request.body?.id,
      title: request.body?.title,
      createdBy: currentUser.id,
      createdByName: currentUser.name,
      canUpdateAll: isAdmin(currentUser),
      defaultRange: request.body?.defaultRange,
      accountTasks: Array.isArray(request.body?.accountTasks)
        ? request.body.accountTasks
        : [],
      accounts: Array.isArray(request.body?.accounts) ? request.body.accounts : [],
      videos: Array.isArray(request.body?.videos) ? request.body.videos : [],
      auditResults:
        request.body?.auditResults && typeof request.body.auditResults === "object"
          ? request.body.auditResults
          : {},
      summary:
        request.body?.summary && typeof request.body.summary === "object"
          ? request.body.summary
          : {},
      status: request.body?.status,
      note: request.body?.note,
    });

    logInfo("douyin.audit_run.saved", {
      ...requestContext(request),
      run_id: run.id,
      status: run.status,
      video_count: run.video_count,
    });
    return sendSuccess(response, { run });
  } catch (error) {
    if (error.code === "AUDIT_RUN_FORBIDDEN") {
      return sendFailure(
        response,
        403,
        "无权限修改该质检记录",
        "DOUYIN_AUDIT_RUN_FORBIDDEN",
      );
    }

    logError("douyin.audit_run.save_failed", error, requestContext(request));
    return sendFailure(
      response,
      500,
      "质检记录保存失败，请稍后重试。",
      "DOUYIN_AUDIT_RUN_SAVE_FAILED",
    );
  }
});

app.get("/api/audit/runs/latest", (request, response) => {
  try {
    const currentUser = getCurrentUser(request);
    const scope = resolveAuditRunScope(request, currentUser);
    return sendSuccess(response, {
      run: getLatestAuditRun({
        createdBy: currentUser.id,
        allUsers: scope === "all" && isAdmin(currentUser),
      }),
    });
  } catch (error) {
    logError("douyin.audit_run.latest_failed", error, requestContext(request));
    return sendFailure(
      response,
      500,
      "最近质检记录读取失败，请稍后重试。",
      "DOUYIN_AUDIT_RUN_LATEST_FAILED",
    );
  }
});

app.get("/api/audit/runs", (request, response) => {
  try {
    const currentUser = getCurrentUser(request);
    const scope = resolveAuditRunScope(request, currentUser);
    return sendSuccess(response, {
      runs: listAuditRuns({
        createdBy: currentUser.id,
        limit: request.query?.limit,
        allUsers: scope === "all" && isAdmin(currentUser),
      }),
      scope,
    });
  } catch (error) {
    logError("douyin.audit_run.list_failed", error, requestContext(request));
    return sendFailure(
      response,
      500,
      "质检历史读取失败，请稍后重试。",
      "DOUYIN_AUDIT_RUN_LIST_FAILED",
    );
  }
});

app.get("/api/audit/runs/:id", (request, response) => {
  try {
    const currentUser = getCurrentUser(request);
    const run = getAuditRun({
      id: request.params.id,
      createdBy: currentUser.id,
      canReadAll: isAdmin(currentUser),
    });

    if (!run) {
      return sendFailure(
        response,
        404,
        "未找到该质检记录。",
        "DOUYIN_AUDIT_RUN_NOT_FOUND",
      );
    }

    return sendSuccess(response, { run });
  } catch (error) {
    if (error.code === "AUDIT_RUN_FORBIDDEN") {
      return sendFailure(
        response,
        403,
        "无权限查看或修改该历史记录。",
        "DOUYIN_AUDIT_RUN_FORBIDDEN",
      );
    }

    logError("douyin.audit_run.detail_failed", error, requestContext(request));
    return sendFailure(
      response,
      500,
      "质检记录详情读取失败，请稍后重试。",
      "DOUYIN_AUDIT_RUN_DETAIL_FAILED",
    );
  }
});

app.delete("/api/audit/runs/:id", (request, response) => {
  try {
    const currentUser = getCurrentUser(request);
    const deleted = deleteAuditRun({
      id: request.params.id,
      createdBy: currentUser.id,
      canDeleteAll: isAdmin(currentUser),
    });

    if (!deleted) {
      return sendFailure(
        response,
        404,
        "未找到该质检记录。",
        "DOUYIN_AUDIT_RUN_NOT_FOUND",
      );
    }

    logInfo("douyin.audit_run.deleted", {
      ...requestContext(request),
      run_id: request.params.id,
    });
    return sendSuccess(response);
  } catch (error) {
    if (error.code === "AUDIT_RUN_FORBIDDEN") {
      return sendFailure(
        response,
        403,
        "无权限查看或修改该历史记录。",
        "DOUYIN_AUDIT_RUN_FORBIDDEN",
      );
    }

    logError("douyin.audit_run.delete_failed", error, requestContext(request));
    return sendFailure(
      response,
      500,
      "质检记录删除失败，请稍后重试。",
      "DOUYIN_AUDIT_RUN_DELETE_FAILED",
    );
  }
});

app.use("/api/audit/runs", (request, response) =>
  sendFailure(
    response,
    404,
    `历史记录接口不可用：${request.method} ${request.originalUrl} 未匹配到已注册路由，请检查后端是否已部署最新版本。`,
    "DOUYIN_AUDIT_RUN_ROUTE_NOT_FOUND",
  ),
);

app.post("/api/audit/douyin-account", async (request, response) => {
  const profileMap = getAccountProfileMap();
  const { defaultRangeInput, accountTasks } = normalizeAccountTasks(
    request.body,
    profileMap,
  );

  if (accountTasks.length === 0) {
    return sendFailure(
      response,
      400,
      "请填写至少一个抖音账号 secUid",
      "DOUYIN_SEC_UID_REQUIRED",
    );
  }

  if (accountTasks.length > 10) {
    return sendFailure(
      response,
      400,
      "一次最多支持 10 个抖音账号。",
      "DOUYIN_SEC_UID_LIMIT_EXCEEDED",
    );
  }

  let defaultRange;

  try {
    defaultRange = resolveDouyinRange(defaultRangeInput);
  } catch (error) {
    if (error instanceof DouyinRangeError) {
      return sendFailure(
        response,
        400,
        error.message,
        "DOUYIN_DATE_RANGE_INVALID",
      );
    }

    throw error;
  }

  console.log(
    "[douyin audit] accountTasks:",
    accountTasks.map((task) => ({
      secUid: task.secUid,
      rangeType: task.rangeType,
      startDate: task.startDate,
      endDate: task.endDate,
    })),
  );
  console.log("[douyin audit] CRAWLER_BASE_URL:", CRAWLER_BASE_URL);
  console.log(
    "[douyin audit] request url:",
    `${CRAWLER_BASE_URL}/douyin/user`,
  );
  console.log("[douyin audit] default range:", {
    rangeType: defaultRange.rangeType,
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  });

  try {
    const accounts = [];
    const videos = [];
    let totalFetched = 0;

    for (
      let accountIndex = 0;
      accountIndex < accountTasks.length;
      accountIndex += 1
    ) {
      const task = accountTasks[accountIndex];
      let accountRange;
      const resolvedRangeInput = resolveAccountTaskRangeInput(
        task,
        defaultRange,
      );

      console.log("[Douyin Account Fetch] account_index:", accountIndex + 1);
      console.log(
        "[Douyin Account Fetch] frontend_name:",
        task.profile?.frontend_name || "",
      );
      console.log("[Douyin Account Fetch] secUid:", task.secUid);
      console.log(
        "[Douyin Account Fetch] secUid length:",
        task.secUid.length,
      );
      console.log(
        "[Douyin Account Fetch] rangeType:",
        resolvedRangeInput.rangeType,
      );
      console.log(
        "[Douyin Account Fetch] startDate:",
        resolvedRangeInput.startDate || "",
      );
      console.log(
        "[Douyin Account Fetch] endDate:",
        resolvedRangeInput.endDate || "",
      );
      console.log(
        "[Douyin Account Fetch] crawler url:",
        `${CRAWLER_BASE_URL}/douyin/user`,
      );

      try {
        if (!task.secUid) {
          throw new DouyinCrawlerError(
            "secUid为空，无法获取视频",
            "DOUYIN_SEC_UID_EMPTY",
          );
        }

        accountRange = resolveDouyinRange(resolvedRangeInput);
        const account = await fetchDouyinAccountVideos({
          secUid: task.secUid,
          accountIndex: accountIndex + 1,
          range: accountRange,
          profile: task.profile,
          profileMatched: task.profileMatched,
        });
        accounts.push(account);
        videos.push(...account.videos);
        totalFetched += account.totalFetched;
      } catch (accountError) {
        const accountMessage = getDouyinAccountErrorMessage(accountError);
        console.error("[Douyin Account Fetch] error message:", accountMessage);
        console.error(
          "[Douyin Account Fetch] error status:",
          accountError.response?.status ?? accountError.crawlerStatus,
        );
        console.error(
          "[Douyin Account Fetch] error data:",
          accountError.response?.data ?? accountError.crawlerData,
        );
        logError("douyin.audit.account_failed", accountError, {
          ...requestContext(request),
          sec_uid: task.secUid,
          account_index: accountIndex + 1,
        });
        accounts.push({
          account_index: accountIndex + 1,
          secUid: task.secUid,
          author_name: "",
          ...pickAccountProfileFields(task.profile),
          profile_matched: task.profileMatched,
          range_label: accountRange
            ? formatRangeLabel(accountRange)
            : getTaskRangeLabel(task, defaultRange),
          range_type:
            accountRange?.rangeType ??
            (task.rangeType === "default"
              ? defaultRange.rangeType
              : task.rangeType),
          count: 0,
          status: "failed",
          message: accountMessage,
          videos: [],
          totalFetched: 0,
        });
      }
    }

    videos.sort(
      (left, right) =>
        Number(right.create_time_ts) - Number(left.create_time_ts),
    );
    videos.forEach((video, index) => {
      video.index = index + 1;
    });
    const responsePayload = {
      count: videos.length,
      videos,
      accounts: accounts.map(
        ({ totalFetched: _totalFetched, ...account }) => account,
      ),
      summary: {
        account_count: accounts.length,
        video_count: videos.length,
        success_count: accounts.filter((account) => account.status === "success")
          .length,
        failed_count: accounts.filter((account) => account.status === "failed")
          .length,
      },
      defaultRange: {
        rangeType: defaultRange.rangeType,
        startDate: defaultRange.startDate,
        endDate: defaultRange.endDate,
      },
      totalFetched,
    };

    if (videos.length === 0) {
      return sendSuccess(response, {
        ...responsePayload,
        message: "该时间范围内未获取到视频",
      });
    }

    logInfo("douyin.audit.loaded", {
      ...requestContext(request),
      account_count: accounts.length,
      success_count: responsePayload.summary.success_count,
      failed_count: responsePayload.summary.failed_count,
      count: videos.length,
      total_fetched: totalFetched,
      default_range_type: defaultRange.rangeType,
    });
    return sendSuccess(response, responsePayload);
  } catch (error) {
    console.error("[douyin audit] crawler error message:", error.message);
    console.error("[douyin audit] crawler error stack:", error.stack);
    console.error(
      "[douyin audit] crawler response status:",
      error.response?.status ?? error.crawlerStatus,
    );
    console.error(
      "[douyin audit] crawler response data:",
      error.response?.data ?? error.crawlerData,
    );
    logError("douyin.audit.failed", error, requestContext(request));
    const developmentDetails =
      process.env.NODE_ENV === "production"
        ? {}
        : {
            detail: error.message,
            crawlerBaseUrl: CRAWLER_BASE_URL,
          };

    return response.status(502).json({
      success: false,
      message: "视频数据获取失败",
      code: "DOUYIN_CRAWLER_UNAVAILABLE",
      ...developmentDetails,
      request_id: request.requestId,
    });
  }
});

function normalizeAccountTasks(body, profileMap = new Map()) {
  const defaultRangeInput = {
    rangeType:
      body?.defaultRange?.rangeType ?? body?.rangeType ?? "last7",
    startDate: body?.defaultRange?.startDate ?? body?.startDate,
    endDate: body?.defaultRange?.endDate ?? body?.endDate,
  };
  const rawTasks =
    Array.isArray(body?.accountTasks) && body.accountTasks.length > 0
      ? body.accountTasks
      : normalizeSecUidValues(body).map((secUid) => ({
          secUid,
          rangeType: "default",
        }));
  const seen = new Set();
  const accountTasks = [];

  for (const rawTask of rawTasks) {
    const secUid = normalizeSecUid(rawTask?.secUid);
    if (secUid && seen.has(secUid)) continue;
    if (secUid) seen.add(secUid);
    const storedProfile = profileMap.get(secUid);
    const requestedRangeType = normalizeAccountTaskRangeType(
      rawTask?.rangeType,
    );
    accountTasks.push({
      secUid,
      rangeType: requestedRangeType,
      startDate: String(rawTask?.startDate ?? "").trim(),
      endDate: String(rawTask?.endDate ?? "").trim(),
      profile: storedProfile
        ? { ...storedProfile }
        : {
            secUid,
            ...pickAccountProfileFields(rawTask),
          },
      profileMatched:
        Boolean(storedProfile) || rawTask?.profile_matched === true,
    });
  }

  return { defaultRangeInput, accountTasks };
}

function normalizeSecUidValues(body) {
  const candidates = Array.isArray(body?.secUids)
    ? body.secUids
    : typeof body?.secUid === "string"
      ? [body.secUid]
      : [];

  return [
    ...new Set(
      candidates
        .flatMap((value) => String(value ?? "").split(/[\s,，]+/u))
        .map(normalizeSecUid)
        .filter(Boolean),
    ),
  ];
}

async function fetchDouyinAccountVideos({
  secUid,
  accountIndex,
  range,
  profile,
  profileMatched,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const uniqueAwemes = new Map();
  const pageLimit = 20;
  const maxPages = 10;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * pageLimit;
      const requestUrl =
        `${CRAWLER_BASE_URL}/douyin/user` +
        `?id=${encodeURIComponent(secUid)}` +
        `&offset=${offset}&limit=${pageLimit}`;
      const crawlerResponse = await fetch(requestUrl, {
        method: "GET",
        signal: controller.signal,
      });
      const responseText = await crawlerResponse.text();
      let crawlerData;

      try {
        crawlerData = responseText ? JSON.parse(responseText) : null;
      } catch {
        const parseError = new DouyinCrawlerError(
          "Crawler 返回内容不是有效 JSON。",
        );
        parseError.crawlerStatus = crawlerResponse.status;
        parseError.crawlerData = responseText.slice(0, 2000);
        throw parseError;
      }

      const pageAwemes = Array.isArray(crawlerData?.data?.aweme_list)
        ? crawlerData.data.aweme_list
        : [];
      console.log("[douyin audit] account:", accountIndex, secUid);
      console.log("[douyin audit] crawler page:", page + 1);
      console.log("[douyin audit] crawler status:", crawlerResponse.status);
      console.log("[douyin audit] aweme count:", pageAwemes.length);

      if (!crawlerResponse.ok) {
        const crawlerMessage = extractCrawlerErrorDetail(crawlerData);
        const crawlerError = new DouyinCrawlerError(
          `Crawler 返回 ${crawlerResponse.status}${
            crawlerMessage ? `：${crawlerMessage}` : ""
          }`,
        );
        crawlerError.crawlerStatus = crawlerResponse.status;
        crawlerError.crawlerData = crawlerData;
        throw crawlerError;
      }

      if (Number(crawlerData?.code) !== 0) {
        const crawlerMessage = extractCrawlerErrorDetail(crawlerData);
        const crawlerError = new DouyinCrawlerError(
          `Crawler 返回 code ${crawlerData?.code ?? "unknown"}${
            crawlerMessage ? `：${crawlerMessage}` : ""
          }`,
        );
        crawlerError.crawlerStatus = crawlerResponse.status;
        crawlerError.crawlerData = crawlerData;
        throw crawlerError;
      }

      const validatedAwemes = extractDouyinAwemeList(crawlerData);
      const sizeBeforePage = uniqueAwemes.size;

      for (const aweme of validatedAwemes) {
        const videoId = String(
          aweme?.aweme_id ?? aweme?.video_id ?? "",
        ).trim();
        if (videoId && !uniqueAwemes.has(videoId)) {
          uniqueAwemes.set(videoId, aweme);
        }
      }

      const matchingVideoCount = [...uniqueAwemes.values()].filter((aweme) => {
        const timestamp = getCreateTimeSeconds(aweme);
        return timestamp >= range.startTime && timestamp <= range.endTime;
      }).length;
      const allPageVideosAreOlder =
        validatedAwemes.length > 0 &&
        validatedAwemes.every(
          (aweme) => getCreateTimeSeconds(aweme) < range.startTime,
        );
      const pageAddedNoNewVideos = uniqueAwemes.size === sizeBeforePage;

      if (
        validatedAwemes.length < pageLimit ||
        allPageVideosAreOlder ||
        pageAddedNoNewVideos ||
        matchingVideoCount >= 50
      ) {
        break;
      }
    }

    const accountVideos = buildDouyinVideos([...uniqueAwemes.values()], {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: 50,
    }).map((video) => ({
      ...video,
      secUid,
      account_index: accountIndex,
      ...pickAccountProfileFields(profile),
      profile_matched: profileMatched,
      account_range_label: formatRangeLabel(range),
      account_range_type: range.rangeType,
    }));
    const authorName =
      accountVideos.find((video) => video.author_name)?.author_name || "";

    return {
      account_index: accountIndex,
      secUid,
      author_name: authorName,
      ...pickAccountProfileFields(profile),
      profile_matched: profileMatched,
      range_label: formatRangeLabel(range),
      range_type: range.rangeType,
      count: accountVideos.length,
      status: "success",
      message: "",
      videos: accountVideos,
      totalFetched: uniqueAwemes.size,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractCrawlerErrorDetail(data) {
  const detail = data?.detail ?? data?.msg ?? data?.message ?? data?.error;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg ?? item?.message ?? JSON.stringify(item))
      .filter(Boolean)
      .join("；");
  }

  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }

  return String(detail ?? "").trim();
}

function getDouyinAccountErrorMessage(error) {
  if (error?.name === "AbortError") {
    return "Crawler timeout：请求超过120秒";
  }

  if (error instanceof TypeError && /fetch|network/iu.test(error.message)) {
    return `Crawler 网络请求失败：${error.message}`;
  }

  return error?.message || "账号作品获取失败";
}

function formatRangeLabel(range) {
  return range.rangeType === "custom"
    ? `${range.startDate} 至 ${range.endDate}`
    : {
        last3: "最近3天",
        last7: "最近7天",
        last30: "最近30天",
      }[range.rangeType] ?? `${range.startDate} 至 ${range.endDate}`;
}

function getTaskRangeLabel(task, defaultRange) {
  if (task.rangeType === "default") {
    return `跟随默认 · ${formatRangeLabel(defaultRange)}`;
  }

  if (task.rangeType === "custom") {
    return task.startDate && task.endDate
      ? `${task.startDate} 至 ${task.endDate}`
      : "自定义日期";
  }

  return {
    last3: "最近3天",
    last7: "最近7天",
    last30: "最近30天",
  }[task.rangeType] ?? task.rangeType;
}

app.post("/api/audit/douyin-videos", async (request, response) => {
  try {
    const testLimit = Number(request.body?.testLimit) === 3 ? 3 : null;
    const requestedVideos = Array.isArray(request.body?.videos)
      ? request.body.videos.slice(0, testLimit ?? undefined)
      : request.body?.videos;
    const videos = prepareAuditVideos(requestedVideos);
    const rules = loadQualityRules();
    const auditItems = buildAuditItems(videos, rules);
    const aiBaseUrl = process.env.AI_BASE_URL?.trim();
    const aiApiKey = process.env.AI_API_KEY?.trim();
    const aiModel = process.env.AI_MODEL?.trim();
    const aiApiType =
      process.env.AI_API_TYPE?.trim().toLowerCase() === "responses"
        ? "responses"
        : "chat_completions";
    const includeAuditDebug = process.env.NODE_ENV !== "production";
    const batchSize = resolveIntegerSetting(
      process.env.AI_AUDIT_BATCH_SIZE,
      2,
      1,
      5,
    );
    const itemTimeoutMs = resolveIntegerSetting(
      process.env.AI_AUDIT_ITEM_TIMEOUT_MS,
      90_000,
      10_000,
      120_000,
    );

    logAiConfiguration();
    console.log("[AI Audit] total videos:", videos.length);
    console.log("[AI Audit] batch size:", batchSize);

    if (!aiBaseUrl || !aiApiKey || !aiModel) {
      throw new LLMConfigurationError(
        "AI 质检模型尚未配置，请设置 AI_BASE_URL、AI_API_KEY 和 AI_MODEL。",
      );
    }

    const auditOneVideo = async (item) => {
        const modelOptions = {
          baseUrl: aiBaseUrl,
          apiKey: aiApiKey,
          model: aiModel,
          apiType: aiApiType,
          includeDebug: includeAuditDebug,
        };
        const hasVideoUrl = isValidVideoUrl(item.play_url);

        if (hasVideoUrl) {
          try {
            return markAuditCompleted(
              await auditVideoWithVision(
                item,
                item.matched_rules,
                modelOptions,
              ),
              item,
            );
          } catch (visualError) {
            if (!(visualError instanceof LLMProviderError)) {
              throw visualError;
            }

            logError("douyin.ai_audit.vision_failed", visualError, {
              ...requestContext(request),
              video_id: item.video_id,
              provider_status: visualError.status,
            });
            const visualErrorMessage =
              aiApiType === "responses"
                ? `Responses API video_url unsupported or failed：${visualError.message}`
                : visualError.message;

            if (shouldSkipTextFallback(visualError)) {
              return buildFinalAuditFallback({
                item,
                error: visualError,
                includeAuditDebug,
                auditMode: "text_fallback",
                visualStatus: "failed",
                visualError: visualErrorMessage,
                request,
              });
            }

            try {
              return markAuditCompleted(
                await auditVideoWithText(item, item.matched_rules, {
                  ...modelOptions,
                  auditMode: "text_fallback",
                  visualStatus: "failed",
                  visualError: visualErrorMessage,
                }),
                item,
              );
            } catch (textError) {
              return buildFinalAuditFallback({
                item,
                error: textError,
                includeAuditDebug,
                auditMode: "text_fallback",
                visualStatus: "failed",
                visualError: visualErrorMessage,
                request,
              });
            }
          }
        }

        const visualStatus = item.play_url
          ? "invalid_video_url"
          : "no_video_url";
        const visualError = item.play_url
          ? "play_url 不是可识别的视频链接。"
          : "";

        try {
          return markAuditCompleted(
            await auditVideoWithText(item, item.matched_rules, {
              ...modelOptions,
              auditMode: "text",
              visualStatus,
              visualError,
            }),
            item,
          );
        } catch (textError) {
          return buildFinalAuditFallback({
            item,
            error: textError,
            includeAuditDebug,
            auditMode: "text",
            visualStatus,
            visualError,
            request,
          });
        }
    };
    const auditOneVideoSafely = async (item) => {
      console.log("[AI Audit] video start:", item.video_id);

      try {
        const result = await withTimeout(
          auditOneVideo(item),
          itemTimeoutMs,
          "单条视频AI质检超时",
        );
        console.log("[AI Audit] video done:", item.video_id);
        return result;
      } catch (error) {
        console.error(
          "[AI Audit] video failed:",
          item.video_id,
          error.message,
        );
        return buildAuditItemFailure(item, error, {
          model: aiModel,
          apiType: aiApiType,
          includeAuditDebug,
        });
      }
    };
    const results = await processInSequentialBatches(
      auditItems,
      auditOneVideoSafely,
      batchSize,
      {
        onBatchStart({ batchIndex }) {
          console.log("[AI Audit] batch start:", batchIndex + 1);
        },
        onBatchEnd({ batchIndex }) {
          console.log("[AI Audit] batch done:", batchIndex + 1);
        },
      },
    );
    const localMatchedCount = auditItems.filter(
      (item) => item.matched_rules.length > 0,
    ).length;
    const fallbackCount = results.filter(
      (result) =>
        result.audit_result === "建议人工复核" &&
        result.main_risks.some((risk) => risk.startsWith("AI 质检")),
    ).length;
    const visionCount = results.filter(
      (result) => result.audit_mode === "video",
    ).length;
    const textFallbackCount = results.filter(
      (result) => result.audit_mode === "text_fallback",
    ).length;
    const auditSummary = summarizeAuditResults(results);

    logInfo("douyin.ai_audit.completed", {
      ...requestContext(request),
      video_count: videos.length,
      local_matched_count: localMatchedCount,
      model: process.env.AI_MODEL?.trim(),
      api_type: aiApiType,
      fallback_count: fallbackCount,
      vision_count: visionCount,
      text_fallback_count: textFallbackCount,
      batch_size: batchSize,
      batch_count: Math.ceil(auditItems.length / batchSize),
    });
    return sendSuccess(response, {
      count: results.length,
      results,
      local_matched_count: localMatchedCount,
      rules_count: rules.length,
      fallback_count: fallbackCount,
      vision_count: visionCount,
      text_fallback_count: textFallbackCount,
      summary: auditSummary,
      batch_size: batchSize,
      item_timeout_ms: itemTimeoutMs,
      test_limit: testLimit,
    });
  } catch (error) {
    if (error instanceof AiAuditInputError) {
      return sendFailure(
        response,
        400,
        error.message,
        "DOUYIN_AI_AUDIT_INPUT_INVALID",
      );
    }

    if (
      error instanceof AiAuditConfigurationError ||
      error instanceof LLMConfigurationError
    ) {
      logError(
        "douyin.ai_audit.configuration_error",
        error,
        requestContext(request),
      );
      return sendFailure(
        response,
        503,
        error.message,
        "DOUYIN_AI_AUDIT_NOT_CONFIGURED",
      );
    }

    if (error instanceof LLMProviderError) {
      logError("douyin.ai_audit.provider_error", error, {
        ...requestContext(request),
        provider_status: error.status,
      });
      return sendFailure(
        response,
        502,
        "AI 质检服务调用失败，请稍后重试。",
        error.code === "AI_MODEL_LIMIT_REACHED"
          ? "AI_MODEL_LIMIT_REACHED"
          : "DOUYIN_AI_AUDIT_PROVIDER_FAILED",
        {
          status: error.status,
          detail: error.detail || error.message,
          model_used: error.model_used,
          api_type: error.api_type,
        },
      );
    }

    throw error;
  }
});

function buildAuditItemFailure(
  item,
  error,
  { model, apiType, includeAuditDebug },
) {
  const isTimeout =
    error?.code === "AI_AUDIT_ITEM_TIMEOUT" ||
    /超时|timeout/iu.test(error?.message ?? "");
  const message = isTimeout
    ? "单条视频AI质检超时"
    : error?.message || "AI质检失败";
  const result = {
    video_id: item.video_id,
    ...getAuditSourceFields(item),
    audit_result: "建议人工复核",
    risk_level: "低",
    main_risks: [isTimeout ? "AI质检超时" : "AI质检失败"],
    hit_rules: [],
    evidence: "",
    visual_evidence: "",
    problem_description: isTimeout
      ? "该视频AI质检超时，建议人工复核"
      : "该视频质检失败，建议人工复核",
    rectification_suggestion: "建议人工查看该视频，或稍后重新质检",
    need_human_review: true,
    audit_status: isTimeout ? "timeout" : "failed",
    audit_mode: "failed",
    visual_status: isTimeout ? "timeout" : "failed",
    visual_error: message,
    error_message: message,
    model_used: model,
    api_type: apiType,
  };

  if (!includeAuditDebug) return result;

  return {
    ...result,
    debug:
      error?.auditDebug ??
      createAuditDebugDetails({
        video: item,
        matchedRules: item.matched_rules,
        userPrompt: buildTextAuditPrompt(item, item.matched_rules),
        rawResponse: error?.raw ?? {
          error: message,
          status: error?.status ?? null,
        },
        model,
        apiType,
        auditMode: "failed",
        visualStatus: result.visual_status,
        visualError: message,
      }),
  };
}

function shouldSkipTextFallback(error) {
  return (
    error?.code === "AI_MODEL_LIMIT_REACHED" ||
    [401, 403, 429].includes(Number(error?.status))
  );
}

function buildFinalAuditFallback({
  item,
  error,
  includeAuditDebug,
  auditMode,
  visualStatus,
  visualError,
  request,
}) {
  if (!(error instanceof LLMProviderError)) {
    throw error;
  }

  logError("douyin.ai_audit.text_failed", error, {
    ...requestContext(request),
    video_id: item.video_id,
    provider_status: error.status,
  });
  const fallback = createProviderFallback(item, error, {
    auditMode,
    visualStatus,
    visualError,
    model: error.model_used ?? process.env.AI_MODEL?.trim(),
    apiType: error.api_type ?? process.env.AI_API_TYPE?.trim(),
  });
  const failedResult = {
    ...fallback,
    ...getAuditSourceFields(item),
    main_risks: ["AI质检失败"],
    problem_description: "该视频质检失败，建议人工复核",
    need_human_review: true,
    audit_status: "failed",
    error_message: error.message || "AI 质检失败",
  };

  if (!includeAuditDebug) {
    return failedResult;
  }

  return {
    ...failedResult,
    debug:
      error.auditDebug ??
      createAuditDebugDetails({
        video: item,
        matchedRules: item.matched_rules,
        userPrompt: buildTextAuditPrompt(item, item.matched_rules),
        rawResponse: error.raw ?? {
          error: error.message,
          status: error.status ?? null,
        },
        model: error.model_used ?? process.env.AI_MODEL?.trim(),
        apiType: error.api_type ?? process.env.AI_API_TYPE?.trim(),
        auditMode,
        visualStatus,
        visualError,
      }),
  };
}

function markAuditCompleted(result, item) {
  return {
    ...result,
    ...getAuditSourceFields(item),
    audit_status: "completed",
    error_message: "",
  };
}

function getAuditSourceFields(item) {
  return {
    secUid: item.secUid,
    account_index: item.account_index,
    author_name: item.author_name,
    frontend_name: item.frontend_name,
    erp_name: item.erp_name,
    operator: item.operator,
    douyin_id: item.douyin_id,
    door_no: item.door_no,
    business_status: item.business_status,
    live_status: item.live_status,
    profile_matched: item.profile_matched,
    account_range_label: item.account_range_label,
    account_range_type: item.account_range_type,
  };
}

app.get("/api/history", (request, response) => {
  try {
    return sendSuccess(response, {
      records: listAiLogs({
        userId: request.user.id,
        allUsers: request.user.role === "admin",
      }),
    });
  } catch (error) {
    logError("history.load_failed", error, requestContext(request));
    return sendFailure(
      response,
      500,
      "历史记录加载失败，请稍后重试。",
      "HISTORY_LOAD_FAILED",
    );
  }
});

app.get("/api/stats", (request, response) => {
  return sendSuccess(response, {
    stats: getUsageStats(request.user.id),
    scope: "personal",
    role: request.user.role,
  });
});

app.get("/api/dashboard", (request, response) => {
  return sendSuccess(response, {
    dashboard: getPersonalDashboard(request.user.id),
    scope: "personal",
    role: request.user.role,
  });
});

app.get("/api/admin/dashboard", requireAdmin, (_request, response) => {
  return sendSuccess(response, {
    dashboard: getAdminDashboard(),
    scope: "global",
    role: "admin",
  });
});

app.get("/api/admin/users", requireAdmin, (_request, response) => {
  return sendSuccess(response, { users: listUsers() });
});

app.post("/api/admin/users", requireAdmin, (request, response) => {
  const username = String(request.body?.username ?? "").trim();
  const password = String(request.body?.password ?? "");
  const name = String(request.body?.name ?? "").trim();
  const role = normalizeUserRole(request.body?.role);

  if (!username) {
    return sendFailure(response, 400, "请输入用户名", "USERNAME_REQUIRED");
  }

  if (!isStrongPassword(password, username)) {
    return sendFailure(
      response,
      400,
      "密码至少 8 位，且不能等于用户名或常见弱密码。",
      "WEAK_PASSWORD",
    );
  }

  const user = upsertUser({
    username,
    password,
    name: name || username,
    role,
    department: role === "admin" ? "management" : role,
  });

  logInfo("admin.user_saved", {
    user_id: user.id,
    username: user.username,
    role: user.role,
  });
  return sendSuccess(response, { user });
});

app.patch("/api/admin/users/:id/password", requireAdmin, (request, response) => {
  const password = String(request.body?.password ?? "");
  const username = String(request.body?.username ?? "");

  if (!isStrongPassword(password, username)) {
    return sendFailure(
      response,
      400,
      "密码至少 8 位，且不能等于用户名或常见弱密码。",
      "WEAK_PASSWORD",
    );
  }

  const user = updateUserPassword({ id: request.params.id, password });

  if (!user) {
    return sendFailure(response, 404, "用户不存在", "USER_NOT_FOUND");
  }

  logInfo("admin.user_password_reset", {
    target_user_id: user.id,
    target_username: user.username,
    operator_id: request.user.id,
  });
  return sendSuccess(response, { user });
});

app.post(
  "/api/generate",
  guardGenerationRequest,
  enforceDailyLimit,
  upload.fields([
    { name: "images", maxCount: maxImageCount },
    { name: "image_file", maxCount: 1 },
    { name: "video_file", maxCount: 1 },
  ]),
  async (request, response) => {
    const apiToken = process.env.COZE_API_TOKEN?.trim();
    const apiBase = (
      process.env.COZE_API_BASE || "https://api.coze.cn"
    ).replace(/\/+$/, "");
    const imageFiles = [
      ...(request.files?.images ?? []),
      ...(request.files?.image_file ?? []),
    ];
    const videoFile = request.files?.video_file?.[0];
    const prompt = request.body?.prompt;
    const toolType = request.body?.tool_type;
    let generationRequest;

    try {
      if (imageFiles.some((file) => file.size > maxImageSize)) {
        return sendFailure(response, 413, "每张图片文件不能超过 20 MB。");
      }

      if (imageFiles.length > maxImageCount) {
        return sendFailure(
          response,
          400,
          `参考图片最多上传 ${maxImageCount} 张。`,
        );
      }

      // Validate text before uploading potentially large media files.
      prepareGenerationRequest({
        prompt,
        toolType,
        assets: {
          imageFiles: imageFiles.map((file) => ({
            fileId: "pending",
            name: file.originalname,
          })),
          videoFileId: videoFile ? "pending" : "",
        },
      });

      if (!apiToken) {
        return sendFailure(
          response,
          500,
          "服务端尚未配置 Coze API Token，请联系管理员。",
        );
      }

      const [uploadedImages, uploadedVideo] = await Promise.all([
        Promise.all(
          imageFiles.map((file) =>
            uploadFileToCoze({ apiBase, apiToken, file }),
          ),
        ),
        videoFile
          ? uploadFileToCoze({ apiBase, apiToken, file: videoFile })
          : null,
      ]);

      generationRequest = prepareGenerationRequest({
        prompt,
        toolType,
        assets: {
          imageFiles: uploadedImages.map((uploadedImage, index) => ({
            fileId: uploadedImage.id,
            name: imageFiles[index]?.originalname,
          })),
          videoFileId: uploadedVideo?.id,
          videoFileName: videoFile?.originalname,
        },
      });
    } catch (error) {
      if (error instanceof GenerationEngineInputError) {
        return sendFailure(response, 400, error.message);
      }

      if (error.message === "COZE_UPLOAD_PERMISSION_DENIED") {
        return sendFailure(
          response,
          403,
          "当前 Coze Token 没有文件上传权限，请管理员启用 uploadFile 权限。",
        );
      }

      if (error.message === "COZE_UPLOAD_FAILED") {
        return sendFailure(
          response,
          502,
          "素材上传到 Coze 失败，请稍后重试。",
        );
      }

      logError("generation.prepare_failed", error, requestContext(request));
      return sendFailure(
        response,
        400,
        "生成请求内容不正确，请检查后重试。",
      );
    }

    if (!generationRequest.workflowId) {
      return sendFailure(
        response,
        500,
        "AI 生成引擎尚未配置 Coze 工作流，请联系管理员。",
      );
    }

    try {
      const workflowResult = await runWithEmptyResultRetry({
        apiBase,
        apiToken,
        workflowId: generationRequest.workflowId,
        parameters: generationRequest.parameters,
      });
      const tokenUsage = workflowResult.usage?.token_count ?? 0;
      const finalResult = finalizeGenerationResult({
        result: workflowResult.result,
        prompt,
        imageCount: imageFiles.length,
      });
      const logId = recordGeneration({
        userId: request.user.id,
        input: generationRequest.input,
        output: finalResult,
        tokenUsage,
        requestId: request.requestId,
      });

      logInfo("generation.completed", {
        ...requestContext(request),
        log_id: logId,
        token_count: tokenUsage,
      });
      return sendSuccess(response, {
        result: finalResult,
        usage: workflowResult.usage ?? { token_count: 0 },
        debug_url: workflowResult.debugUrl,
        raw: workflowResult.raw,
        log_id: logId,
      });
    } catch (error) {
      const message =
        error.name === "AbortError"
          ? "生成超时，请稍后重新尝试。"
          : getCozeFailureMessage(error.raw, error.status, error.message);

      logError("generation.failed", error, requestContext(request));
      return sendFailure(
        response,
        error.status || 502,
        message,
        "COZE_GENERATION_FAILED",
      );
    }
  },
);

function handleLogin(request, response) {
  const username = String(request.body?.username ?? "").trim();
  const password = String(request.body?.password ?? "");

  if (!username) {
    return sendFailure(response, 400, "请输入用户名", "USERNAME_REQUIRED");
  }

  if (!password) {
    return sendFailure(response, 400, "请输入密码", "PASSWORD_REQUIRED");
  }

  const user = authenticateUser(username, password);

  if (!user) {
    return sendFailure(response, 401, "账号或密码错误", "AUTH_INVALID");
  }

  const session = createSession(user.id);
  response.setHeader(
    "Set-Cookie",
    buildSessionCookie(session.token, session.maxAgeSeconds),
  );

  logInfo("auth.login", { user_id: user.id, username: user.username });
  return sendSuccess(response, { user });
}

function handleLogout(request, response) {
  deleteSession(readCookie(request, "session_id"));
  response.setHeader("Set-Cookie", buildSessionCookie("", 0));
  return sendSuccess(response);
}

function handleMe(request, response) {
  const user = getUserBySessionToken(readCookie(request, "session_id"));

  if (!user) {
    return sendFailure(response, 401, "未登录", "AUTH_REQUIRED");
  }

  return sendSuccess(response, { user });
}

function requireAuth(request, response, next) {
  const token = readCookie(request, "session_id");
  const user = getUserBySessionToken(token);

  if (!user) {
    return sendFailure(response, 401, "登录已过期，请重新登录。");
  }

  request.user = user;
  return next();
}

function requireAdmin(request, response, next) {
  if (!isAdmin(request.user)) {
    return sendFailure(response, 403, "仅管理员可以查看运营数据。");
  }

  return next();
}

function getCurrentUser(request) {
  if (!request.user) return null;

  return {
    id: String(request.user.id),
    username: request.user.username,
    name: request.user.name || request.user.displayName || request.user.username,
    role: request.user.role,
  };
}

function isAdmin(user) {
  return user?.role === "admin" || user?.username === "admin";
}

function normalizeUserRole(value) {
  return value === "admin" ? "admin" : value === "content" ? "content" : "viewer";
}

function isStrongPassword(password, username = "") {
  const value = String(password ?? "");
  const normalized = value.toLowerCase();
  const weakPasswords = new Set([
    "123456",
    "12345678",
    "password",
    "admin",
    "admin123",
    "qwerty123",
  ]);

  return (
    value.length >= 8 &&
    normalized !== String(username ?? "").trim().toLowerCase() &&
    !weakPasswords.has(normalized)
  );
}

function resolveAuditRunScope(request, user) {
  return isAdmin(user) && request.query?.scope === "all" ? "all" : "mine";
}

function enforceDailyLimit(request, response, next) {
  const stats = getUsageStats(request.user.id);

  if (stats.today_count >= stats.daily_limit) {
    return sendFailure(response, 429, "今日额度已用完");
  }

  return next();
}

function guardGenerationRequest(request, response, next) {
  const existing = getGenerationByRequestId({
    userId: request.user.id,
    requestId: request.requestId,
  });

  if (existing) {
    logInfo("generation.idempotent_hit", {
      ...requestContext(request),
      log_id: existing.id,
    });
    return sendSuccess(response, {
      result: existing.output,
      usage: { token_count: existing.token_usage },
      debug_url: null,
      log_id: existing.id,
      cached: true,
    });
  }

  const guard = acquireUserRequest(request.user.id, request.requestId);

  if (!guard.acquired) {
    return sendFailure(
      response,
      409,
      "当前账号已有生成任务正在进行，请等待完成后再试。",
      "GENERATION_IN_PROGRESS",
      {
        active_request_id: guard.activeRequestId,
      },
    );
  }

  const release = () => guard.release();
  response.once("finish", release);
  response.once("close", release);
  return next();
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";

  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return "";
}

function buildSessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    `session_id=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    secure,
  ]
    .filter(Boolean)
    .join("; ");
}

async function uploadFileToCoze({ apiBase, apiToken, file }) {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([file.buffer], { type: file.mimetype }),
    file.originalname,
  );

  const uploadResponse = await fetch(`${apiBase}/v1/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: formData,
  });
  const responseText = await uploadResponse.text();
  const raw = parseCozeError(responseText, uploadResponse.status);
  const code = Number(raw?.code);

  if (
    uploadResponse.status === 401 ||
    uploadResponse.status === 403 ||
    code === 4100 ||
    code === 4101
  ) {
    const error = new Error("COZE_UPLOAD_PERMISSION_DENIED");
    error.raw = raw;
    throw error;
  }

  const fileId = raw?.data?.id ?? raw?.data?.file_id ?? raw?.id;

  if (!uploadResponse.ok || (code && code !== 0) || !fileId) {
    const error = new Error("COZE_UPLOAD_FAILED");
    error.raw = raw;
    throw error;
  }

  return {
    id: String(fileId),
    raw,
  };
}

async function runWithEmptyResultRetry(options) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await runCozeWorkflow(options);

      if (!isEmptyWorkflowResult(result.result)) {
        return result;
      }

      lastError = new Error("EMPTY_RESULT");
    } catch (error) {
      if (error.message !== "EMPTY_RESULT") {
        throw error;
      }

      lastError = error;
    }
  }

  const error = new Error("EMPTY_RESULT");
  error.raw = lastError?.raw ?? {};
  throw error;
}

async function runCozeWorkflow({
  apiBase,
  apiToken,
  workflowId,
  parameters,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    // This is the previously verified Coze request path. Keep it unchanged.
    const cozeResponse = await fetch(`${apiBase}/v1/workflow/stream_run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        parameters,
      }),
      signal: controller.signal,
    });

    const responseText = await cozeResponse.text();

    if (!cozeResponse.ok) {
      const error = new Error("COZE_REQUEST_FAILED");
      error.status = cozeResponse.status;
      error.raw = parseCozeError(responseText, cozeResponse.status);
      throw error;
    }

    let workflowResult;

    try {
      workflowResult = extractWorkflowResultWithFallback(responseText);
    } catch (error) {
      if (error.code === "EMPTY_RESULT") {
        const emptyError = new Error("EMPTY_RESULT");
        emptyError.raw = error.raw;
        throw emptyError;
      }

      throw error;
    }

    if (isEmptyWorkflowResult(workflowResult.result)) {
      const error = new Error("EMPTY_RESULT");
      error.raw = workflowResult.raw;
      throw error;
    }

    return workflowResult;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCozeError(responseText, status) {
  try {
    return JSON.parse(responseText);
  } catch {
    return { status, body: responseText };
  }
}

function getCozeFailureMessage(raw, status, internalMessage) {
  const code = Number(raw?.code ?? raw?.error_code);

  if (internalMessage === "EMPTY_RESULT") {
    return "Coze 暂未生成有效内容，请稍后重新尝试。";
  }

  if (status === 401 || code === 4100) {
    return "Coze 鉴权失败，请联系管理员更新 API Token。";
  }

  if (code === 4200) {
    return "未找到对应的 Coze 工作流，请联系管理员检查配置。";
  }

  if (status === 429) {
    return "请求过于频繁，请稍后重新尝试。";
  }

  return "Coze 服务调用失败，请稍后重试。";
}

function sendSuccess(response, payload = {}, status = 200) {
  return response.status(status).json({
    success: true,
    ...payload,
    request_id: response.req.requestId,
  });
}

function normalizeUploadFileName(value) {
  const fileName = String(value ?? "").trim();
  if (!fileName) return "";

  const canBeLatin1 = [...fileName].every(
    (character) => character.codePointAt(0) <= 255,
  );
  if (!canBeLatin1) return fileName;

  const decoded = Buffer.from(fileName, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? fileName : decoded;
}

function sendFailure(
  response,
  status,
  message,
  code = "REQUEST_FAILED",
  details,
) {
  return response.status(status).json({
    success: false,
    message,
    code,
    request_id: response.req.requestId,
    ...(details ? { details } : {}),
  });
}

function requestContext(request) {
  return {
    request_id: request.requestId,
    user_id: request.user?.id,
    method: request.method,
    path: request.originalUrl,
  };
}

function resolveIntegerSetting(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function logAiConfiguration() {
  const apiType =
    process.env.AI_API_TYPE?.trim().toLowerCase() === "responses"
      ? "responses"
      : "chat_completions";
  console.log("[AI Config] AI_MODEL:", process.env.AI_MODEL?.trim() || "");
  console.log("[AI Config] AI_API_TYPE:", apiType);
  console.log("[AI Config] AI_BASE_URL:", process.env.AI_BASE_URL?.trim() || "");
}

app.use((error, request, response, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return sendFailure(
        response,
        413,
        "文件过大：视频不能超过 100 MB，每张图片不能超过 20 MB。",
      );
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return sendFailure(
        response,
        400,
        `参考视频只能上传 1 个，参考图片最多上传 ${maxImageCount} 张。`,
      );
    }

    return sendFailure(response, 400, "素材上传失败，请重新选择。");
  }

  if (error.message === "UNSUPPORTED_MEDIA_TYPE") {
    return sendFailure(
      response,
      400,
      "图片仅支持 JPG、PNG、WebP、GIF；视频仅支持 MP4、MOV、WebM、AVI。",
    );
  }

  if (error instanceof SyntaxError && "body" in error) {
    return sendFailure(response, 400, "请求内容格式不正确。");
  }

  logError("server.unhandled_error", error, requestContext(request));
  return sendFailure(
    response,
    500,
    "服务器内部错误，请稍后重试。",
    "INTERNAL_SERVER_ERROR",
  );
});

app.use("/api", (_request, response) => {
  return sendFailure(response, 404, "请求的接口不存在。");
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
