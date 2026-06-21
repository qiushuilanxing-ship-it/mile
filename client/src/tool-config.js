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
    id: "product_script",
    index: "02",
    name: "AI 产品脚本生成",
    shortName: "产品脚本",
    shortDescription: "把产品素材组织成短视频脚本",
    title: "把产品素材转成完整视频脚本",
    description:
      "参考视频定义内容节奏，产品图片帮助 AI 识别外观，再生成完整的短视频脚本。",
    promptPlaceholder:
      "例如：面向 25–35 岁女性，生成一条 20 秒真人实拍产品脚本。",
    defaultPrompt:
      "请参考上传视频的表达节奏，为图片中的产品生成一条完整短视频脚本，包含开场钩子、逐镜头画面、口播文案和结尾行动引导。",
    accent: "orange",
    cover: "/tool-covers/product-script.webp",
    previewLabel: "逐镜脚本",
  },
  {
    id: "sales_copy",
    index: "03",
    name: "带货文案生成",
    shortName: "带货文案",
    shortDescription: "生成卖点清晰的口播与转化文案",
    title: "从视频素材提炼带货表达",
    description:
      "AI 会参考视频的沟通方式与产品素材，输出带货口播、标题和行动引导。",
    promptPlaceholder:
      "例如：语气真实、不夸张，突出使用场景，同时生成 3 个标题。",
    defaultPrompt:
      "请参考上传视频的内容结构，为图片中的产品生成带货文案，包含开场钩子、核心卖点、场景化口播、标题和行动引导。",
    accent: "blue",
    cover: "/tool-covers/sales-copy.webp",
    previewLabel: "转化口播",
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
