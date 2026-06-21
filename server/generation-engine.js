export class GenerationEngineInputError extends Error {}

export function prepareGenerationRequest({
  prompt,
  toolType = "video_reverse",
  assets = {},
}) {
  const userPrompt = clean(prompt);
  const imageFiles = normalizeImageFiles(assets);

  if (!userPrompt) {
    throw new GenerationEngineInputError("请输入 Prompt。");
  }

  if (userPrompt.length > 20_000) {
    throw new GenerationEngineInputError("Prompt 不能超过 20000 个字符。");
  }

  if (!assets.videoFileId) {
    throw new GenerationEngineInputError("请上传参考视频后再生成。");
  }

  if (imageFiles.length === 0) {
    throw new GenerationEngineInputError("请至少上传 1 张参考图片。");
  }

  if (imageFiles.length > 10) {
    throw new GenerationEngineInputError("参考图片最多上传 10 张。");
  }

  return {
    workflowId:
      clean(process.env.COZE_WORKFLOW_ID_ENGINE) ||
      clean(process.env.COZE_WORKFLOW_ID_BENCHMARK),
    parameters: {
      // The verified workflow start node accepts only the video variable.
      video: fileReference(assets.videoFileId),
    },
    input: {
      tool_type: normalizeToolType(toolType),
      prompt: userPrompt,
      images: imageFiles,
      video_file: assets.videoFileId
        ? {
            file_id: String(assets.videoFileId),
            name: clean(assets.videoFileName),
          }
        : null,
    },
  };
}

export function finalizeGenerationResult({
  result,
  prompt,
  imageCount = 0,
}) {
  const content =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const userPrompt = clean(prompt);
  const targetProduct = extractTargetProduct(userPrompt);
  let adjustedContent = content;

  if (targetProduct) {
    const brandPhonePattern =
      /(vivo|oppo|华为|荣耀|小米|红米|苹果|iphone|努比亚|一加|魅族|realme|真我)\s*手机/gi;
    const brandPattern =
      /\b(vivo|oppo|iphone|realme)\b|华为|荣耀|小米|红米|苹果|努比亚|一加|魅族|真我/gi;

    adjustedContent = adjustedContent
      .replace(brandPhonePattern, targetProduct)
      .replace(brandPattern, targetProduct);
  }

  const requirements = [
    "> 已结合本次输入进行产品化调整。",
    "",
    "## 本次生成要求",
    userPrompt,
    targetProduct ? `- 目标替换产品：${targetProduct}` : "",
    imageCount > 0
      ? `- 产品参考图：已上传 ${imageCount} 张，请综合参考图片中的外观、颜色、材质、比例和品牌标识。`
      : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return `${requirements}\n${adjustedContent}`.trim();
}

function extractTargetProduct(prompt) {
  const match = prompt.match(
    /(?:替换为|替换成|换成|改成)\s*([^，。,.！!\n]{1,30})/i,
  );

  if (!match) {
    return "";
  }

  return match[1]
    .trim()
    .replace(/的手机$/u, "手机")
    .replace(/的产品$/u, "产品");
}

function fileReference(fileId) {
  return JSON.stringify({ file_id: String(fileId) });
}

function normalizeImageFiles(assets) {
  const files = Array.isArray(assets.imageFiles)
    ? assets.imageFiles
    : assets.imageFileId
      ? [
          {
            fileId: assets.imageFileId,
            name: assets.imageFileName,
          },
        ]
      : [];

  return files
    .filter((file) => file?.fileId)
    .map((file) => ({
      file_id: String(file.fileId),
      name: clean(file.name),
    }));
}

function normalizeToolType(value) {
  const toolType = clean(value);
  const supportedTypes = new Set([
    "video_reverse",
    "product_script",
    "sales_copy",
  ]);

  return supportedTypes.has(toolType) ? toolType : "video_reverse";
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
