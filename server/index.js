import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import {
  authenticateUser,
  createSession,
  deleteSession,
  getAdminDashboard,
  getGenerationByRequestId,
  getPersonalDashboard,
  getUsageStats,
  getUserBySessionToken,
  listAiLogs,
  recordGeneration,
} from "./database.js";
import {
  finalizeGenerationResult,
  GenerationEngineInputError,
  prepareGenerationRequest,
} from "./generation-engine.js";
import {
  extractWorkflowResultWithFallback,
  isEmptyWorkflowResult,
} from "./coze-stream.js";
import { logError, logInfo } from "./logger.js";
import { acquireUserRequest } from "./request-guard.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const maxVideoSize = 100 * 1024 * 1024;
const maxImageSize = 20 * 1024 * 1024;
const configuredMaxImageCount = Number(process.env.MAX_IMAGE_COUNT);
const maxImageCount =
  Number.isInteger(configuredMaxImageCount) && configuredMaxImageCount > 0
    ? configuredMaxImageCount
    : 10;
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

app.use((request, response, next) => {
  const clientRequestId = request.get("X-Request-Id")?.trim();
  request.requestId =
    clientRequestId && clientRequestId.length <= 100
      ? clientRequestId
      : crypto.randomUUID();
  response.setHeader("X-Request-Id", request.requestId);
  next();
});
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_request, response) => {
  return sendSuccess(response, { ok: true });
});

app.post("/api/auth/login", (request, response) => {
  const user = authenticateUser(
    request.body?.username,
    request.body?.password,
  );

  if (!user) {
    return sendFailure(response, 401, "用户名或密码错误。");
  }

  const session = createSession(user.id);
  response.setHeader(
    "Set-Cookie",
    buildSessionCookie(session.token, session.maxAgeSeconds),
  );

  logInfo("auth.login", { user_id: user.id, username: user.username });
  return sendSuccess(response, { user });
});

app.post("/api/auth/logout", (request, response) => {
  deleteSession(readCookie(request, "session_id"));
  response.setHeader("Set-Cookie", buildSessionCookie("", 0));
  return sendSuccess(response);
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  return sendSuccess(response, { user: request.user });
});

app.use("/api", requireAuth);

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
  if (request.user.role !== "admin") {
    return sendFailure(response, 403, "仅管理员可以查看运营数据。");
  }

  return next();
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
