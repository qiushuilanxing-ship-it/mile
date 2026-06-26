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

## 抖音短视频质检

### 质检名单

```http
POST /api/audit/account-list/import
Content-Type: multipart/form-data
```

上传字段名为 `file`，仅支持不超过 10MB 的 `.xlsx` 文件。系统优先读取
“直播间名称”工作表，并根据表头识别“账号主页UID”“前端名称”“ERP名称”
“运营/编剪”“门牌”等字段。解析结果覆盖保存到
`server/data/account_profiles.json`，该文件已加入 `.gitignore`。

```http
GET /api/audit/account-list
```

用于读取最近一次导入的账号资料库、导入统计和上传时间。

### 获取账号作品

```http
POST /api/audit/douyin-account
Content-Type: application/json
```

推荐请求示例（支持每个账号单独设置日期范围）：

```json
{
  "defaultRange": {
    "rangeType": "last7",
    "startDate": "",
    "endDate": ""
  },
  "accountTasks": [
    {
      "secUid": "抖音账号 secUid 1",
      "rangeType": "last7",
      "startDate": "",
      "endDate": ""
    },
    {
      "secUid": "抖音账号 secUid 2",
      "rangeType": "custom",
      "startDate": "2026-06-01",
      "endDate": "2026-06-04"
    }
  ]
}
```

`rangeType` 支持 `last3`、`last7`、`last30` 和 `custom`。后端每页读取
20 条，最多读取 10 页，按作品发布时间过滤并为每个账号最多返回 50 条。
一次最多支持 10 个账号，多个账号会按输入顺序抓取，不会并发请求 Crawler。
单个账号失败不会中断其他账号。旧版 `secUid`、`secUids` 和公共日期参数仍然兼容。

## 质检规则库

源文件：

```text
server/data/source/米乐科技短视频质检规范库_V1.xlsx
```

生成网站规则库：

```bash
cd server
npm run build:quality-rules
```

输出文件：

```text
server/data/mile_quality_rules.json
```

规则 JSON 由主规则表、违规词库、整改建议库和案例库合并生成，不依赖
Coze 知识库。

AI 视频视觉质检接口：

```http
POST /api/audit/douyin-videos
Content-Type: application/json
```

请求体为当前页面筛选出的 `videos` 数组，最多 50 条。接口先使用
`mile_quality_rules.json` 的关键词进行本地初筛，再调用独立配置的
火山方舟豆包模型进行综合判断。有可用 `play_url` 时，后端直接以
`video_url` 形式把远程视频地址交给模型审核画面与文案；不会下载视频、
不会抽帧，也不依赖 ffmpeg。视频地址无效、不可访问或视觉理解失败时，
该条记录会自动降级为文本质检，不影响同批其他视频。AI 质检按每批 5 条
执行，批内并发、批次之间顺序等待，并返回通过、整改、人工复核、高风险和
失败统计。

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
CRAWLER_BASE_URL=http://127.0.0.1:8080
AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AI_API_KEY=
AI_MODEL=doubao-seed-2-1-turbo-260628
AI_TIMEOUT_MS=90000
AI_VISION_TIMEOUT_MS=180000
AI_AUDIT_CONCURRENCY=2
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
