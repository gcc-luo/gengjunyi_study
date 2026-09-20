# 家庭学习视频 Web MVP

一个供单个家庭私有使用的儿童视频学习 Web 应用。家长创建孩子档案、课程并上传视频；孩子从课程中观看内容，学习进度、收藏和记录保存在服务端，可跨设备继续。V1 面向 Ubuntu 单机公网部署，支持 100 GB 私有 MinIO 视频库；不开放注册，不包含 Android App，也不提供自动备份。

## 当前能力

- 单家庭管理员数据模型、HttpOnly 会话 Cookie 与 CSRF/来源校验；当前默认启用全局免登录，任何能访问站点的人都拥有家长管理权限，不提供公开注册。
- 多孩子档案、课程草稿/发布/下架、目录排序、服务端学习记录与存储配额。
- 浏览器向 MinIO 进行 MP4 分片直传，展示真实进度，支持失败续传；刷新后重新选择同名同大小源文件继续。
- H.264/AAC MP4 服务端校验；私有对象经授权后以短时签名链接播放，支持 HTTP Range、断点续看、90% 完成判定。
- 一台 Ubuntu 云服务器的 Docker Compose、Caddy HTTPS、PostgreSQL 与 MinIO 配置见[部署指南](docs/deployment/ubuntu-docker.md)。
- 无域名、供同一局域网手机访问的 Ubuntu 一键部署脚本见[局域网部署指南](docs/deployment/ubuntu-lan.md)。

## 本地开发

需要 Node.js、npm 和 Docker Compose。先启动仅绑定回环地址的开发数据库与 MinIO：

```sh
docker compose -f ops/compose.dev.yaml up -d postgres minio
docker compose -f ops/compose.dev.yaml run --rm minio-init
npm ci
```

在 API 终端配置开发连接并启动迁移、学科目录和 MinIO 桶（PowerShell 示例）：

```powershell
$env:DATABASE_URL = "postgresql://family_learning_test:family_learning_test_local_only@127.0.0.1:15432/family_learning_test"
$env:MINIO_ENDPOINT = "127.0.0.1"
$env:MINIO_PORT = "19000"
$env:MINIO_USE_SSL = "false"
$env:MINIO_ACCESS_KEY = "family_learning_api"
$env:MINIO_SECRET_KEY = "family_test_app_secret_local"
$env:MINIO_BUCKET = "family-learning-mvp-test"
$env:MINIO_PUBLIC_URL = "http://127.0.0.1:19000"
$env:APP_ORIGIN = "http://localhost:5173"
$env:TRUSTED_PROXIES = ""
$env:SESSION_SECRET = "local-development-only-session-secret"
npm run db:migrate:deploy
npm run db:seed
npm run storage:init
npm run admin:create
npm run server:dev
```

在另一个终端启动前端：

```sh
npm run dev
```

访问 <http://localhost:5173>。开发环境不使用真实家庭资料或正式凭据；首次通过 `/api/auth/session` 自动使用 `npm run admin:create` 创建的管理员建立免登录会话。需要恢复密码登录时，需同时关闭 `AUTH_BYPASS` 并恢复登录界面。

## 验证

```sh
export DATABASE_URL=postgresql://family_learning_test:family_learning_test_local_only@127.0.0.1:15432/family_learning_test
npm run test:all
npm run test:e2e
npm run build
npm run server:build
```

PowerShell 中先运行 `$env:DATABASE_URL = "postgresql://family_learning_test:family_learning_test_local_only@127.0.0.1:15432/family_learning_test"`，再执行上面的测试命令。

数据库集成测试需 `DATABASE_URL` 指向本地名称以 `_test` 结尾的数据库；开发 Compose 已提供 `127.0.0.1:15432/family_learning_test`。真实 MinIO 集成测试需先启动开发 MinIO，并运行：

```powershell
$env:RUN_MINIO_TESTS = "1"
npx vitest run server/test/storage/minio.test.ts
```

macOS/Linux 可运行 `RUN_MINIO_TESTS=1 npx vitest run server/test/storage/minio.test.ts`。

`npm run test:e2e` 使用 Playwright 和状态化模拟 API/MinIO 验证浏览器界面流程，不等同于全栈真实服务 E2E；API、数据库与 MinIO 目前由各自的测试套件独立验证。部署前仍需在目标 Ubuntu 主机完成真实 HTTPS、域名、浏览器直传和播放验收。

## 产品边界

实例不含公开注册、多家庭租户、原生 Android、视频转码、CDN、DRM、公开分享、支付或评论。部署只提供单机持久卷，不提供备份与恢复；删除视频会同时删除其学习记录。生产公网入口只开放 Caddy 的 HTTP/HTTPS 端口，数据库与 MinIO Console 不开放公网访问。
