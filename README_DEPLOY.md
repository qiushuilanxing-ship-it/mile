# AI 内容引擎部署指南

本文面向第一次部署 Node.js 项目的同学，介绍本地开发、前端构建、服务器部署、PM2 启动后端、Nginx 配置和环境变量用途。

项目由两个独立部分组成：

```text
company-ai-tools/
├─ client/                 React + Vite 前端
│  ├─ src/
│  ├─ public/
│  ├─ .env.example
│  └─ package.json
├─ server/                 Node.js + Express 后端
│  ├─ data/                SQLite 数据库默认目录
│  ├─ .env.example
│  ├─ index.js
│  └─ package.json
├─ README.md
└─ README_DEPLOY.md
```

生产环境推荐使用以下结构：

```text
浏览器
  ├─ 页面和静态资源 → Nginx → client/dist
  └─ /api 请求      → Nginx → Node.js 后端（PM2，端口 3001）
```

## 一、本地开发

### 1. 安装基础软件

需要安装：

- Node.js 18 或更高版本，推荐使用当前 LTS 版本
- npm

检查是否安装成功：

```bash
node -v
npm -v
```

### 2. 配置后端环境变量

进入后端目录，复制环境变量示例：

Windows PowerShell：

```powershell
cd D:\ruanjian\code\mile\company-ai-tools\server
Copy-Item .env.example .env
```

Linux/macOS：

```bash
cd /path/to/company-ai-tools/server
cp .env.example .env
```

然后编辑 `server/.env`，填写真实的 Coze Token 和工作流 ID。不要把真实 Token 写进代码，也不要提交 `.env`。

### 3. 安装依赖并启动后端

```bash
cd server
npm install
npm run dev
```

看到以下信息表示后端启动成功：

```text
Server running at http://localhost:3001
```

可以访问健康检查接口：

```text
http://localhost:3001/api/health
```

### 4. 配置并启动前端

打开另一个终端：

```bash
cd client
npm install
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:5173/
```

开发环境中，Vite 会自动把 `/api` 请求代理到 `http://localhost:3001`。

如果后端不在本机或端口不是 `3001`，可以在 `client/.env` 中配置：

```env
VITE_API_PROXY_TARGET=http://192.168.1.10:3001
```

修改前端 `.env` 后需要重启 `npm run dev`。

### 5. 本地验证

后端测试：

```bash
cd server
npm test
```

前端测试和构建：

```bash
cd client
npm test
npm run build
```

## 二、服务器准备

以下命令以 Ubuntu/Debian 服务器为例。

### 1. 安装 Node.js、Nginx 和 PM2

建议通过 NodeSource、nvm 或服务器的软件管理方式安装 Node.js LTS。

安装完成后检查：

```bash
node -v
npm -v
```

安装 Nginx：

```bash
sudo apt update
sudo apt install -y nginx
```

全局安装 PM2：

```bash
sudo npm install -g pm2
pm2 -v
```

### 2. 上传项目

示例部署目录：

```text
/var/www/company-ai-tools
```

上传代码后，目录应类似：

```text
/var/www/company-ai-tools/client
/var/www/company-ai-tools/server
```

不要上传本地的 `node_modules`。在服务器上分别执行 `npm install`。

## 三、前端生产构建

进入前端目录：

```bash
cd /var/www/company-ai-tools/client
npm install
npm run build
```

构建成功后会生成：

```text
/var/www/company-ai-tools/client/dist
```

这个目录包含生产环境的 HTML、CSS、JavaScript 和图片，由 Nginx 直接提供。

每次修改前端代码后，都需要重新执行：

```bash
npm run build
```

然后刷新浏览器。一般不需要重启后端。

## 四、后端生产配置

### 1. 创建 `.env`

```bash
cd /var/www/company-ai-tools/server
cp .env.example .env
nano .env
```

示例：

```env
COZE_API_TOKEN=请填写真实的_Coze_API_Token
COZE_WORKFLOW_ID_ENGINE=
COZE_WORKFLOW_ID_BENCHMARK=请填写已验证的视频工作流_ID
COZE_API_BASE=https://api.coze.cn
PORT=3001
SQLITE_PATH=/var/lib/company-ai-tools/company-ai-tools.db
MAX_IMAGE_COUNT=10
CRAWLER_BASE_URL=http://127.0.0.1:8080
AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AI_API_KEY=
AI_MODEL=doubao-seed-2-1-turbo-260628
AI_TIMEOUT_MS=90000
AI_VISION_TIMEOUT_MS=180000
AI_AUDIT_CONCURRENCY=2
```

创建独立的数据库目录：

```bash
sudo mkdir -p /var/lib/company-ai-tools
sudo chown -R $USER:$USER /var/lib/company-ai-tools
```

这样重新发布项目代码时，不容易误删 SQLite 数据库。

### 2. 安装后端依赖

```bash
cd /var/www/company-ai-tools/server
npm install --omit=dev
```

项目使用 `better-sqlite3`。如果安装时出现本地编译错误，可安装编译工具后重试：

```bash
sudo apt install -y build-essential python3
npm install --omit=dev
```

## 五、使用 PM2 启动后端

必须把 PM2 工作目录设置为 `server`，否则 `dotenv` 可能找不到 `server/.env`。

```bash
pm2 start index.js \
  --name company-ai-tools-api \
  --cwd /var/www/company-ai-tools/server \
  --time
```

查看状态：

```bash
pm2 status
```

查看日志：

```bash
pm2 logs company-ai-tools-api
```

重新启动：

```bash
pm2 restart company-ai-tools-api
```

停止服务：

```bash
pm2 stop company-ai-tools-api
```

保存当前 PM2 进程列表，并设置服务器重启后自动启动：

```bash
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条需要使用 `sudo` 执行的命令。复制并执行该命令，然后再次执行：

```bash
pm2 save
```

后端启动后，在服务器本机验证：

```bash
curl http://127.0.0.1:3001/api/health
```

## 六、Nginx 代理配置

创建配置文件：

```bash
sudo nano /etc/nginx/sites-available/company-ai-tools
```

基础配置示例：

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name ai.example.com;

    root /var/www/company-ai-tools/client/dist;
    index index.html;

    # 视频最大 100 MB，同时可能上传多张图片，因此不能只设置为 100 MB。
    client_max_body_size 350m;

    # React Router 前端路由支持。
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 所有 API 请求转发到 Express。
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Coze 工作流最长可能等待约 180 秒。
        proxy_connect_timeout 30s;
        proxy_send_timeout 240s;
        proxy_read_timeout 240s;

        # 避免代理缓冲影响长时间响应和大文件上传。
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

把 `ai.example.com` 换成自己的域名。如果暂时没有域名，可以写服务器公网 IP：

```nginx
server_name 你的服务器IP;
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/company-ai-tools \
  /etc/nginx/sites-enabled/company-ai-tools
```

如果默认站点发生冲突，可以移除默认配置：

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

检查 Nginx 配置：

```bash
sudo nginx -t
```

配置正确后重新加载：

```bash
sudo systemctl reload nginx
```

## 七、HTTPS 和登录 Cookie

正式环境强烈建议配置 HTTPS，可以使用 Certbot 免费申请 Let's Encrypt 证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ai.example.com
```

如果后续给 PM2 设置：

```text
NODE_ENV=production
```

后端会给登录 Cookie 添加 `Secure` 属性。此时网站必须通过 HTTPS 访问，否则浏览器不会保存登录 Cookie，表现为“登录后立即掉线”。

因此推荐组合是：

```text
生产环境 + NODE_ENV=production + HTTPS
```

## 八、环境变量说明

### `server/.env.example`

它是后端环境变量模板，只用于说明需要配置哪些变量，不包含真实密钥。

| 变量 | 用途 |
|---|---|
| `COZE_API_TOKEN` | Coze OpenAPI Token。用于上传文件和调用工作流，必须保密。 |
| `COZE_WORKFLOW_ID_ENGINE` | AI 内容引擎工作流 ID。填写后优先使用该工作流。 |
| `COZE_WORKFLOW_ID_BENCHMARK` | 已验证的视频工作流 ID，同时也是 `ENGINE` 未填写时的备用工作流。 |
| `COZE_API_BASE` | Coze API 地址，国内环境通常为 `https://api.coze.cn`。 |
| `PORT` | Express 后端监听端口，默认 `3001`。 |
| `SQLITE_PATH` | SQLite 文件位置。留空时使用 `server/data/company-ai-tools.db`。生产环境建议填写独立持久化路径。 |
| `MAX_IMAGE_COUNT` | 后端允许一次上传的最大图片数量，默认 `10`。 |
| `CRAWLER_BASE_URL` | 本机或内网 Crawler 服务地址，默认 `http://127.0.0.1:8080`。该地址只配置在后端，不会暴露给浏览器。 |
| `AI_BASE_URL` | 火山方舟 API 基址，当前使用 `https://ark.cn-beijing.volces.com/api/v3`。 |
| `AI_API_KEY` | 火山方舟 API Key，只能放在后端 `.env`，不能提交或暴露给前端。 |
| `AI_MODEL` | AI 视频理解与文本降级质检模型，当前使用 `doubao-seed-2-1-turbo-260628`。 |
| `AI_TIMEOUT_MS` | 文本降级质检的超时时间，默认 `90000` 毫秒。 |
| `AI_VISION_TIMEOUT_MS` | 视频视觉理解的超时时间，默认 `180000` 毫秒。 |
| `AI_AUDIT_CONCURRENCY` | 同时质检的视频数量，视频理解建议默认 `2`，允许范围为 `1-5`。 |

正确用法：

```bash
cp server/.env.example server/.env
```

然后只编辑 `server/.env`。不要直接把真实 Token 写进 `.env.example`。

### `client/.env.example`

它是前端构建变量模板：

| 变量 | 用途 |
|---|---|
| `VITE_MAX_IMAGE_COUNT` | 前端允许选择的最大图片数量，应与后端的 `MAX_IMAGE_COUNT` 保持一致。 |

开发环境还可以在 `client/.env` 中增加：

```env
VITE_API_PROXY_TARGET=http://localhost:3001
```

所有以 `VITE_` 开头的变量都会在前端构建时注入浏览器代码，因此绝对不能在前端 `.env` 中放 Coze Token、密码或其他秘密。

修改 `client/.env` 后必须重新运行开发服务或重新构建：

```bash
npm run build
```

## 九、数据库和备份

项目使用 SQLite 保存：

- 用户
- 登录会话
- 生成历史
- Token 用量
- 调用记录

默认数据库位于：

```text
server/data/company-ai-tools.db
```

生产环境推荐使用 `SQLITE_PATH` 指向项目目录之外的持久化位置。

备份前可先执行：

```bash
pm2 stop company-ai-tools-api
```

然后复制数据库文件：

```bash
cp /var/lib/company-ai-tools/company-ai-tools.db \
  /var/backups/company-ai-tools-$(date +%F).db
```

备份完成后重新启动：

```bash
pm2 restart company-ai-tools-api
```

## 十、更新发布流程

以后更新代码时，可以按照以下顺序操作：

```bash
cd /var/www/company-ai-tools

# 拉取或上传新代码后，更新后端依赖并重启。
cd server
npm install --omit=dev
npm test
pm2 restart company-ai-tools-api

# 更新前端依赖并重新构建。
cd ../client
npm install
npm test
npm run build

# 检查并重新加载 Nginx。
sudo nginx -t
sudo systemctl reload nginx
```

不要删除生产数据库目录，也不要用新的空数据库覆盖原数据库。

## 十一、常见问题

### 页面可以打开，但 API 请求返回 502

检查后端是否运行：

```bash
pm2 status
pm2 logs company-ai-tools-api
curl http://127.0.0.1:3001/api/health
```

### 上传视频时出现 413

说明 Nginx 上传限制过小。确认配置中包含：

```nginx
client_max_body_size 350m;
```

修改后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 工作流长时间运行后返回 504

确认 Nginx 超时不低于后端的 180 秒：

```nginx
proxy_send_timeout 240s;
proxy_read_timeout 240s;
```

### 登录成功后又回到登录页

依次检查：

1. 浏览器是否通过 HTTPS 访问。
2. PM2 是否设置了 `NODE_ENV=production`。
3. Nginx 是否传递了 `X-Forwarded-Proto`。
4. SQLite 数据库目录是否可写。

### Coze 文件上传失败

检查：

1. `COZE_API_TOKEN` 是否正确。
2. Token 是否拥有文件上传权限。
3. `COZE_API_BASE` 是否为当前账号对应的区域地址。
4. 视频格式和大小是否符合限制。

### 前端刷新子页面出现 404

确认 Nginx 的前端配置包含：

```nginx
try_files $uri $uri/ /index.html;
```
