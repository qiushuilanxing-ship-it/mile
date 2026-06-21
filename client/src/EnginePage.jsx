import { useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getTool } from "./tool-config.js";
import {
  extractDisplayResult,
  formatDisplayResult,
} from "./result-utils.js";

const configuredMaxImages = Number(import.meta.env.VITE_MAX_IMAGE_COUNT);
const MAX_IMAGES =
  Number.isInteger(configuredMaxImages) && configuredMaxImages > 0
    ? configuredMaxImages
    : 10;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

export default function EnginePage() {
  const { toolId } = useParams();
  const location = useLocation();
  const requestIdRef = useRef("");
  const activeTool = getTool(toolId);
  const [prompt, setPrompt] = useState(location.state?.initialPrompt ?? "");
  const [imageFiles, setImageFiles] = useState([]);
  const [videoFile, setVideoFile] = useState(null);
  const [result, setResult] = useState("");
  const [usage, setUsage] = useState(null);
  const [debugUrl, setDebugUrl] = useState("");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  if (!activeTool || activeTool.reserved) {
    return <Navigate to="/" replace />;
  }

  function addImages(selectedFiles) {
    setError("");
    const incoming = Array.from(selectedFiles);

    if (incoming.some((file) => file.size > MAX_IMAGE_SIZE)) {
      setError("每张参考图片不能超过 20 MB。");
      return;
    }

    const knownFiles = new Set(
      imageFiles.map(
        (file) => `${file.name}:${file.size}:${file.lastModified}`,
      ),
    );
    const uniqueFiles = incoming.filter(
      (file) =>
        !knownFiles.has(`${file.name}:${file.size}:${file.lastModified}`),
    );
    const nextFiles = [...imageFiles, ...uniqueFiles];

    if (nextFiles.length > MAX_IMAGES) {
      setError(`参考图片最多上传 ${MAX_IMAGES} 张。`);
    }

    setImageFiles(nextFiles.slice(0, MAX_IMAGES));
  }

  async function generate({ preserveResult = false } = {}) {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");
    setCopyStatus("");

    if (!preserveResult) {
      setResult("");
      setUsage(null);
      setDebugUrl("");
    }

    try {
      validateInput({ imageFiles, videoFile });
      requestIdRef.current ||= createClientRequestId();

      const body = new FormData();
      body.append("tool_type", activeTool.id);
      body.append("prompt", prompt.trim() || activeTool.defaultPrompt);
      imageFiles.forEach((file) => body.append("images", file));
      body.append("video_file", videoFile);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "X-Request-Id": requestIdRef.current },
        body,
      });
      const payload = await response.json().catch(() => null);
      requestIdRef.current = "";

      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "生成失败，请稍后重新尝试。");
      }

      const displayResult = extractDisplayResult(payload);

      if (
        displayResult === "" ||
        displayResult === null ||
        displayResult === undefined
      ) {
        throw new Error("AI 暂未返回有效内容，请重新生成。");
      }

      setResult(formatDisplayResult(displayResult));
      setUsage(payload.usage ?? { token_count: 0 });
      setDebugUrl(payload.debug_url ?? "");
    } catch (requestError) {
      const isNetworkError =
        requestError instanceof TypeError &&
        requestError.message.toLowerCase().includes("fetch");
      setError(
        isNetworkError
          ? "无法连接到后端服务，请确认服务已启动。"
          : requestError.message || "生成失败，请稍后重新尝试。",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    generate();
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(result);
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败");
    }
  }

  return (
    <div className="page-content tool-platform">
      <header className="platform-heading tool-page-heading">
        <div>
          <Link className="back-home-link" to="/">
            ← 返回工具首页
          </Link>
          <span className="eyebrow">AI TOOL · {activeTool.index}</span>
          <h1>{activeTool.name}</h1>
          <p>{activeTool.description}</p>
        </div>
        <Link className="history-shortcut" to="/history">
          <span>HISTORY</span>
          查看生成记录
        </Link>
      </header>

      <section className="platform-workspace tool-page-workspace">
        <form className="tool-input-panel" onSubmit={handleSubmit}>
          <header className="tool-module-heading">
            <div>
              <span className="module-index">{activeTool.index}</span>
              <span className="card-kicker">ACTIVE TOOL</span>
            </div>
            <h2>{activeTool.title}</h2>
            <p>{activeTool.description}</p>
          </header>

          <div className="input-steps">
            <InputStep
              number="1"
              title="上传参考视频"
              requirement="必填"
              description="视频是主要分析素材，AI 将理解镜头、节奏和内容结构。"
              emphasis="primary"
            >
              <SingleMediaField
                label="参考视频"
                accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
                file={videoFile}
                setFile={setVideoFile}
                disabled={isLoading}
                hint="MP4、MOV、WebM、AVI · 最大 100 MB"
                icon="VID"
                emphasis="primary"
              />
              {!videoFile && (
                <div className="video-suggestion">
                  请先上传参考视频，它决定生成内容的结构和质量
                </div>
              )}
            </InputStep>

            <InputStep
              number="2"
              title="上传参考图片"
              requirement="1–10 张"
              description="可分批添加产品、包装、细节或视觉风格图片。"
            >
              <MultiImageField
                files={imageFiles}
                onAdd={addImages}
                onRemove={(index) =>
                  setImageFiles((currentFiles) =>
                    currentFiles.filter((_, fileIndex) => fileIndex !== index),
                  )
                }
                disabled={isLoading}
              />
            </InputStep>

            <InputStep
              number="3"
              title="补充生成要求"
              requirement="可选"
              description="不填写时将按当前工具的默认任务生成；建议补充产品、受众和输出偏好。"
              emphasis="secondary"
            >
              <label className="prompt-field">
                <textarea
                  className="prompt-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows="7"
                  maxLength="20000"
                  placeholder={activeTool.promptPlaceholder}
                  disabled={isLoading}
                />
                <span className="prompt-counter">
                  {prompt.length} / 20000
                </span>
              </label>
            </InputStep>
          </div>

          {error && (
            <div className="error-box input-error" role="alert">
              <strong>暂时无法生成</strong>
              <p>{error}</p>
            </div>
          )}

          <button
            className="primary-button generate-button"
            type="submit"
            disabled={isLoading || !videoFile || imageFiles.length === 0}
          >
            {isLoading
              ? "生成中..."
              : !videoFile
                ? "请先上传参考视频"
                : imageFiles.length === 0
                  ? "请至少上传 1 张参考图片"
                  : `使用「${activeTool.name}」生成`}
          </button>
        </form>

        <ResultPanel
          result={result}
          usage={usage}
          debugUrl={debugUrl}
          error={error}
          isLoading={isLoading}
          copyStatus={copyStatus}
          onCopy={copyOutput}
          onRegenerate={() => generate({ preserveResult: true })}
          toolName={activeTool.name}
        />
      </section>
    </div>
  );
}

function ResultPanel({
  result,
  usage,
  debugUrl,
  error,
  isLoading,
  copyStatus,
  onCopy,
  onRegenerate,
  toolName,
}) {
  return (
    <section className="tool-output-panel" aria-live="polite">
      <header className="result-heading">
        <div>
          <span className="card-kicker">UNIFIED OUTPUT</span>
          <h2>AI 生成结果</h2>
        </div>
        <span className="result-usage">
          {usage ? `${usage.token_count ?? 0} Tokens` : "等待生成"}
        </span>
      </header>

      {!result && !error && !isLoading && (
        <div className="engine-empty">
          <span>AI</span>
          <h3>{toolName}的结果将在这里展开</h3>
          <p>支持 Markdown、列表、表格与结构化脚本。</p>
        </div>
      )}

      {isLoading && (
        <div className="engine-empty">
          <div className="result-loading-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h3>AI 正在理解素材</h3>
          <p>视频任务可能需要 30 秒到 2 分钟，请保持页面开启。</p>
        </div>
      )}

      {error && !result && (
        <div className="result-error">
          <span>生成未完成</span>
          <p>{error}</p>
        </div>
      )}

      {result && !isLoading && (
        <div className="engine-result">
          <article className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
          </article>
          <div className="engine-result-actions">
            <button className="small-button" type="button" onClick={onCopy}>
              {copyStatus || "复制生成结果"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={onRegenerate}
              disabled={isLoading}
            >
              重新生成
            </button>
            <Link to="/history">查看历史记录</Link>
            {debugUrl && (
              <a href={debugUrl} target="_blank" rel="noreferrer">
                Coze 调试记录
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SingleMediaField({
  label,
  accept,
  file,
  setFile,
  disabled,
  hint,
  icon,
  emphasis = "secondary",
}) {
  return (
    <div className={`media-field media-${emphasis}`}>
      <label
        className={[
          "file-control",
          `file-control-${emphasis}`,
          file ? "has-file" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <input
          type="file"
          accept={accept}
          multiple={false}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={disabled}
        />
        <span className="file-icon">{icon}</span>
        <strong>{file ? file.name : `选择${label}`}</strong>
        <small>{file ? formatFileSize(file.size) : hint}</small>
      </label>
      {file && (
        <button
          className="remove-button"
          type="button"
          onClick={() => setFile(null)}
          disabled={disabled}
        >
          移除
        </button>
      )}
    </div>
  );
}

function MultiImageField({ files, onAdd, onRemove, disabled }) {
  return (
    <div className="multi-image-field">
      <label
        className={[
          "multi-image-uploader",
          files.length ? "has-images" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(event) => {
            onAdd(event.target.files ?? []);
            event.target.value = "";
          }}
          disabled={disabled || files.length >= MAX_IMAGES}
        />
        <span className="file-icon">IMG</span>
        <span>
          <strong>
            {files.length
              ? `继续添加图片（还可添加 ${MAX_IMAGES - files.length} 张）`
              : "选择 1–10 张参考图片"}
          </strong>
          <small>支持 JPG、PNG、WebP、GIF · 单张最大 20 MB</small>
        </span>
        <span className="image-count">
          {files.length} / {MAX_IMAGES}
        </span>
      </label>

      {files.length > 0 && (
        <div className="image-file-list">
          {files.map((file, index) => (
            <article
              className="image-file-item"
              key={`${file.name}-${file.size}-${file.lastModified}`}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong title={file.name}>{file.name}</strong>
                <small>{formatFileSize(file.size)}</small>
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={disabled}
                aria-label={`移除 ${file.name}`}
              >
                移除
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function InputStep({
  number,
  title,
  requirement,
  description,
  emphasis = "standard",
  children,
}) {
  return (
    <section className={`input-step input-step-${emphasis}`}>
      <header className="input-step-heading">
        <span className="step-number">STEP {number}</span>
        <div>
          <div className="step-title-row">
            <h3>{title}</h3>
            <span className="requirement">{requirement}</span>
          </div>
          <p>{description}</p>
        </div>
      </header>
      <div className="input-step-content">{children}</div>
    </section>
  );
}

function validateInput({ imageFiles, videoFile }) {
  if (!videoFile) {
    throw new Error("请上传参考视频后再生成。");
  }

  if (imageFiles.length === 0) {
    throw new Error("请至少上传 1 张参考图片。");
  }

  if (imageFiles.length > MAX_IMAGES) {
    throw new Error(`参考图片最多上传 ${MAX_IMAGES} 张。`);
  }

  if (imageFiles.some((file) => file.size > MAX_IMAGE_SIZE)) {
    throw new Error("每张参考图片不能超过 20 MB。");
  }

  if (videoFile.size > MAX_VIDEO_SIZE) {
    throw new Error("视频文件不能超过 100 MB。");
  }
}

function formatFileSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function createClientRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
