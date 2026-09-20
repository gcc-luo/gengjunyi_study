# Ubuntu 单机公网部署

本文将一个家庭实例部署到一台 Ubuntu 云服务器：Caddy 自动申请 HTTPS；Nginx 提供前端；Fastify API 连接 PostgreSQL 和私有 MinIO。只有 Caddy 发布到宿主机；PostgreSQL、MinIO Console、Web 与 API 均不绑定公网端口。视频公网流量由 MinIO 的专用 HTTPS 域名承载，不经过 API。

本方案面向单家庭、100 GB 媒体配额，不含自动备份、恢复、转码、集群或 SLA。Docker 持久卷可承受普通容器重建，但不是备份；磁盘或服务器损坏、误删、密钥丢失都可能造成不可恢复的数据损失。

## 1. 准备服务器与域名

- 使用受支持的 Ubuntu LTS 云服务器；建议系统盘之外为 Docker 数据目录预留空间。100 GB 是媒体配额，不包含操作系统、数据库、上传中的分片、容器镜像及升级空间。
- 准备一个域名，例如 `learn.example.com`，并创建两条指向此服务器公网 IPv4 的 DNS A 记录：`learn.example.com` 和 `s3.learn.example.com`。如配置 AAAA 记录，服务器也必须能通过 IPv6 接收 80/443 端口流量。
- 在云厂商安全组和 Ubuntu 防火墙仅开放 SSH，以及 TCP 80、TCP 443、UDP 443。不要开放 3000、5432、9000、9001 或容器管理端口。
- 安装 Docker Engine 和 Docker Compose 插件，参考 [Docker 官方 Ubuntu 安装指南](https://docs.docker.com/engine/install/ubuntu/)。

确认 DNS 已生效，且 80/443 未被其他服务占用。Caddy 首次启动时会向公开 CA 申请证书，因此域名必须已解析到此服务器且公网入站可达。

## 2. 获取代码并配置密钥

在服务器上克隆本项目，并进入项目目录。复制生产环境模板：

```sh
cp ops/.env.production.example ops/.env.production
```

编辑 `ops/.env.production`：填写 `APP_DOMAIN`、`APP_ORIGIN`、`S3_DOMAIN` 三项真实公网域名；分别生成 PostgreSQL 密码、MinIO root 密钥、MinIO 应用账号密钥和 `SESSION_SECRET`。MinIO 应用 access key 固定为 `family_learning_api`，只需设置其独立 secret key。应用和数据库密码用 URL 安全的十六进制值，避免 PostgreSQL URL 中的特殊字符需要额外转义。`SESSION_SECRET` 必须粘贴 `openssl rand -base64 48` 输出的完整随机值，不要手工编写：

```sh
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 32
openssl rand -base64 48
```

请勿把真实 `.env.production` 提交到 Git、截图或发送到聊天中。该文件已加入 Git 忽略规则。模板中的示例密码不能用于正式部署。

验证 Compose 配置能解析（安静模式不会把展开后的秘密打印出来）：

```sh
docker compose --env-file ops/.env.production -f ops/compose.production.yaml config -q
```

启动时 preflight 会拒绝模板域名、占位密钥、过短密钥和重复密钥；数据库与 MinIO 在检查通过前不会启动。

Compose 固定将 Caddy 放在 `172.30.42.2`，API 的 `TRUSTED_PROXIES` 默认也使用此地址。如果服务器上的 Docker 网段已有冲突，应一起修改 `ops/compose.production.yaml` 中 public 网段、Caddy 静态地址以及 `.env.production` 的 `TRUSTED_PROXIES`，并确保 Caddy 地址仍属于该网段。

## 3. 启动服务并创建家长账号

```sh
docker compose --env-file ops/.env.production -f ops/compose.production.yaml up -d --build
docker compose --env-file ops/.env.production -f ops/compose.production.yaml ps
```

首次启动会等待 PostgreSQL 与 MinIO 健康检查。`minio-init` 使用 root 凭据创建私有桶和仅限该桶对象操作的应用账号；随后应用数据库迁移、写入学科目录并检查桶可用性，最后启动 API 和 HTTPS 入口。创建唯一的家长管理员：

```sh
docker compose --env-file ops/.env.production -f ops/compose.production.yaml run --rm admin
```

按提示输入家长邮箱、密码并再次确认；密码输入不会显示。系统没有公开注册入口。需要重置密码时运行：

```sh
docker compose --env-file ops/.env.production -f ops/compose.production.yaml run --rm admin npm run admin:create -- --reset
```

并输入当前唯一管理员邮箱。

检查 `https://learn.example.com/api/health` 返回 `{"status":"ok"}`，然后通过 `https://learn.example.com/` 登录。家长端首次使用时创建孩子档案、课程并上传视频。

## 4. 网络与存储边界

- Caddy 是唯一发布宿主机端口的服务，负责 Web/API 路由与 TLS。`/api/*` 转发到 API，其余网页路由转发到静态 Web 容器。
- `s3.learn.example.com` 由 Caddy 转发到 MinIO S3 API，供浏览器按需使用短时预签名 URL 直传分片和读取已授权视频。MinIO CORS 仅允许 `APP_ORIGIN`。
- PostgreSQL 位于只供 API 访问的内部网络；MinIO 位于只供 API、Caddy 与初始化服务访问的内部网络。MinIO Console 9001 没有公网代理或宿主机端口。
- MinIO 桶保持私有。浏览器不会得到 MinIO 长期凭据；API 只使用限制在 `MINIO_BUCKET` 桶内的应用账号，MinIO root 凭据仅供 MinIO 本身和初始化容器使用。初始化会重建固定应用用户和策略，使 `.env.production` 中的应用 secret key 在每次初始化时生效。
- PostgreSQL 和 MinIO 数据位于 Compose 命名卷 `postgres_data`、`minio_data`；桶名保护状态位于 `minio_bucket_state`，Caddy 证书状态位于 `caddy_data`。必须保留 `minio_data` 与 `minio_bucket_state` 两个卷，不能单独删除 marker 卷；不要使用 `docker compose down -v`，它会删除业务数据卷。
- 初次初始化会把 `MINIO_BUCKET` 写入独立配置卷；后续若尝试改名，初始化将失败而不会悄悄切换到空桶。迁移媒体时需单独规划对象复制和数据库 object key 更新，不要直接改 `.env.production`。
- 上传配额固定为 100,000,000,000 字节（100 GB 十进制）。应用按对象实际字节数和活动上传预留空间拒绝超额上传；这不会限制服务器磁盘的物理使用量。

## 5. 更新与运维

更新代码后，在项目目录执行：

```sh
git pull --ff-only
docker compose --env-file ops/.env.production -f ops/compose.production.yaml up -d --build
```

Compose 会在 API 启动前应用尚未执行的数据库迁移。查看服务状态可用 `docker compose ... ps`；排查启动失败可查看 `docker compose ... logs --tail=100 api caddy migrate`。分享日志前请检查是否包含不应公开的信息。

监控云主机磁盘使用率并为系统、PostgreSQL、MinIO multipart 暂存及镜像更新保留余量。MinIO 会清理由应用配置为超过 7 天未活动的 multipart 上传；不要把该机制当作媒体清理或备份。

此版本明确不配置自动备份。家长端归档视频默认保留 MinIO 对象及其学习历史，并可恢复；这不等同于备份，服务器磁盘故障、目录或卷删除、数据库误操作仍没有内置恢复路径。只有在充分理解这一数据风险后，才将家庭原始视频放入此实例。

## 常见问题

- **登录后请求报 403 / Cookie 不安全：** 确认通过 HTTPS 访问、`APP_ORIGIN` 与浏览器地址的 scheme/host/port 完全一致，并且 `TRUSTED_PROXIES` 与 Caddy 静态地址匹配。
- **视频上传 CORS 失败：** 确认 S3 DNS 与证书正常，`APP_ORIGIN` 精确匹配网站来源，MinIO 已使用该环境变量重启；浏览器开发者工具中的预检请求应到达 `s3` 域名。
- **视频可上传但无法播放或拖动：** 确认对象是 H.264/AAC MP4、`S3_DOMAIN` 可从互联网通过 HTTPS 访问，并且反向代理保留浏览器请求的 `Host`。服务端会拒绝其他容器或编码。
- **磁盘快满但应用仍有配额：** 100 GB 是产品数据配额，不是磁盘容量限制；停止继续上传并先扩容云盘。V1 不会自动删除旧视频腾空间。
