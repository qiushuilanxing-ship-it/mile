# 公司 AI 内容工具台

公司内部使用的多工具 AI 内容生产平台。当前包含：

- 视频反推提示词
- AI 产品脚本生成
- 带货文案生成
- 对标视频拆解（预留）
- Prompt 优化器（预留）

## 页面

- `/`：创作首页、快捷场景与热门工具入口
- `/tools/video_reverse`：视频反推提示词工作区
- `/tools/product_script`：AI 产品脚本工作区
- `/tools/sales_copy`：带货文案工作区
- `/dashboard`：当前用户调用与 Token 数据
- `/history`：生成历史
- `/admin/dashboard`：管理员全局数据
- `/login`：登录

## 生成接口

```http
POST /api/generate
Content-Type: multipart/form-data
```

字段：

```text
tool_type=video_reverse | product_script | sales_copy
video_file=<必填，1 个，最大 100 MB>
images=<必填，可重复提交 1–10 个文件，单张最大 20 MB>
prompt=<可选；前端未填写时会使用当前工具的默认任务说明>
```

后端会先把素材上传到 Coze，再把图片统一记录为：

```json
{
  "images": [
    { "file_id": "img1", "name": "front.jpg" },
    { "file_id": "img2", "name": "detail.jpg" }
  ]
}
```

现有已验证的 Coze 工作流仍使用 `video` 开始节点变量，调用路径和 SSE
解析逻辑未改动。若需要让 Coze 节点直接读取多图，请在对应工作流中增加图片数组输入。

## 环境变量

后端 `server/.env`：

```env
COZE_API_TOKEN=你的_Coze_API_Token
COZE_WORKFLOW_ID_ENGINE=
COZE_WORKFLOW_ID_BENCHMARK=已验证的视频工作流_ID
COZE_API_BASE=https://api.coze.cn
PORT=3001
SQLITE_PATH=
MAX_IMAGE_COUNT=10
```

前端可选配置 `client/.env`：

```env
VITE_MAX_IMAGE_COUNT=10
```

前后端的图片数量配置应保持一致。上传图片或视频需要 Token 开启
`uploadFile` 权限。

## 启动

后端：

```powershell
cd D:\ruanjian\code\mile\company-ai-tools\server
npm install
npm run dev
```

前端：

```powershell
cd D:\ruanjian\code\mile\company-ai-tools\client
npm install
npm run dev
```

访问 `http://127.0.0.1:5173/`。

## 验证

```powershell
cd D:\ruanjian\code\mile\company-ai-tools\server
npm test
```

```powershell
cd D:\ruanjian\code\mile\company-ai-tools\client
npm test
npm run build
```
