# Ubuntu 局域网一键部署

本方案用于家庭局域网，不需要域名或 Docker 之外的额外宿主机软件。Ubuntu 服务器和手机需连接到彼此可达的同一网络。LAN Compose 默认通过 DaoCloud 镜像前缀拉取 Docker Hub 和 Quay 镜像。

## 首次启动

```bash
git clone <项目仓库地址>
cd <克隆后的项目目录>
bash ./ops/deploy-lan.sh
```

脚本会检查 Docker Engine 与 Compose 插件，生成本机 `.env.lan`，构建并启动 Web、API、PostgreSQL 和 MinIO，初始化数据库/私有视频桶，并创建默认家长账号。数据库和视频使用独立的 Docker 命名卷保存。

部署成功后脚本会打印访问地址和家长账号：

- 主站：`http://<Ubuntu服务器局域网IP>:8189`
- 家长账号：`parent@family.test`
- 初始密码：`FamilyLearningParent2026!`
- MinIO S3 API：`http://<Ubuntu服务器局域网IP>:9000`（供网页上传和播放使用，不是管理界面）

在手机浏览器输入主站地址即可。若脚本选错网卡，可查看 `ip -4 addr`，使用服务器实际的局域网 IPv4 重跑：

```bash
BIND_IP=192.168.1.20 bash ./ops/deploy-lan.sh
```

若 shell 不允许直接执行，也可运行 `bash ops/deploy-lan.sh`。重复运行会保留 `.env.lan` 内的数据库/MinIO 密钥，不重置已经存在的管理员密码，也不会删除数据卷。

## 网络要求

手机必须能路由到 Ubuntu 服务器的局域网 IP。服务器防火墙和 Wi‑Fi 客户端隔离设置需允许设备访问 TCP 8189（网页）和 TCP 9000（MinIO 视频）。例如服务器启用了 UFW 时，可按实际家庭网段放行：

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8189 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 9000 proto tcp
```

请将示例网段替换成你的局域网网段。云服务器即使运行 Ubuntu，也只有在手机所在网络能访问它的私有地址/专线网络时才能作为“局域网”访问；公网访问推荐使用已有的 HTTPS 部署方案。

## HTTP 内网穿透（不推荐）

如确认接受明文 HTTP 的风险，可通过内网穿透临时访问。穿透服务需要同时将公网 TCP 8189、9000 转发到 Ubuntu 的局域网 IP 对应端口；`APP_ORIGIN` 必须与浏览器地址的协议、IP/域名和端口完全一致，MinIO 公网地址也必须能从浏览器访问：

```bash
APP_ORIGIN=http://123.57.228.45:8189 \
MINIO_PUBLIC_URL=http://123.57.228.45:9000 \
bash ./ops/deploy-lan.sh
```

请替换为你自己的公网入口。脚本会保存这两个地址，后续重跑时会保留；若更换公网入口，重新设置这两个环境变量再运行。公网 HTTP 会明文传输登录密码和会话 Cookie，不建议长期或在不可信网络中使用。

## 停止与数据

在项目目录执行以下命令可停止服务，但保留数据库和视频：

```bash
docker compose --project-name family-learning-lan --env-file .env.lan --file ops/compose.lan.yaml down
```

不要追加 `-v`，否则会删除数据库、视频及 MinIO 初始化状态卷。MinIO 管理控制台和 PostgreSQL 没有发布到宿主机端口。

此部署使用明文 HTTP 和仓库内固定初始密码。默认仅适合可信家庭局域网；公网 HTTP 内网穿透仅供用户明确接受风险后的临时使用。

## 镜像来源

Docker Hub 官方镜像默认通过 `m.daocloud.io/docker.io` 获取，MinIO 镜像通过 `m.daocloud.io/quay.io` 获取。需要更换镜像源时，编辑 `.env.lan` 中的 `DOCKERHUB_PREFIX` 和 `QUAY_PREFIX`，然后再次运行部署脚本。镜像代理服务也可能出现暂时不可用；若拉取仍超时，先分别测试这些域名的网络连通性。
