export const tools = [
  {
    id: "video_reverse",
    index: "01",
    name: "视频反推提示词",
    shortName: "视频反推",
    shortDescription: "拆解镜头、节奏与画面语言",
    title: "从参考视频反推可复用提示词",
    description:
      "上传参考视频和产品图片，AI 会理解镜头结构与表达方式，生成可直接使用的视频提示词。",
    promptPlaceholder:
      "可补充产品名称、需要替换的内容、目标平台或输出格式。",
    defaultPrompt:
      "请深度拆解上传的参考视频，提取镜头、节奏、画面、人物动作和文案结构，并生成可复用的视频提示词与逐镜头脚本。",
    accent: "violet",
    cover: "/tool-covers/video-reverse.webp",
    previewLabel: "镜头结构",
  },
  {
    id: "benchmark_analysis",
    index: "04",
    name: "对标视频拆解",
    shortName: "对标拆解",
    shortDescription: "结构、镜头和节奏分析",
    accent: "pink",
    cover: "/tool-covers/benchmark-analysis.webp",
    previewLabel: "即将开放",
    reserved: true,
  },
  {
    id: "prompt_optimizer",
    index: "05",
    name: "Prompt 优化器",
    shortName: "Prompt 优化",
    shortDescription: "把模糊需求整理成专业指令",
    accent: "green",
    cover: "/tool-covers/prompt-optimizer.webp",
    previewLabel: "即将开放",
    reserved: true,
  },
];

export function getTool(toolId) {
  return tools.find((tool) => tool.id === toolId);
}
