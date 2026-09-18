# LAN 一键部署脚本设计

## 目标

在 Ubuntu 服务器已安装 Docker Engine 与 Compose 插件的前提下，用户克隆仓库后运行 `./ops/deploy-lan.sh`，即可启动单家庭 Web MVP。服务器与手机位于同一局域网时，手机可通过服务器局域网 IPv4 打开主站、上传视频和播放视频。不要求域名、TLS 或公网注册。

## 方案与取舍

1. **推荐：新增独立 LAN Compose 与脚本。** 主站和 MinIO S3 API 同机部署，分别发布到服务器 LAN IPv4 的 8080、9000 端口；Compose 内服务仍以服务名互通。保留现有公网生产部署，不影响其 HTTPS、域名和安全配置。
2. 改造公网 Compose 兼容无域名模式。减少文件，但会把 TLS/公网约束与 LAN 明文 HTTP 配置混在一起，不采用。

LAN Compose 使用 Caddy 的显式 HTTP 端口 8080 代理 `/api/*` 到 API，其余流量到 Web；MinIO S3 API 端口 9000 直接由浏览器访问，MinIO Console 不发布。API 的内部 MinIO endpoint 仍为 `minio:9000`，预签名 URL 使用 `http://<LAN IPv4>:9000`，MinIO CORS 只放行 `http://<LAN IPv4>:8080`。

## 脚本行为

- 入口为仓库根目录的 `./ops/deploy-lan.sh`；检查 Docker daemon 和 Compose 插件，不负责安装 Docker。
- 默认通过主路由解析服务器 LAN IPv4，也允许 `BIND_IP` 覆盖；绑定选定 IP，而不是仅绑定 loopback。
- 首次运行创建被 Git 忽略的 `.env.lan`，其中写入固定的本地数据库、MinIO root/app、管理员和会话配置；重复运行保留已有配置并更新 LAN IP/URL。
- 使用独立 Compose project 名与命名数据卷；启动 PostgreSQL、MinIO、桶/受限应用账号初始化、数据库迁移/seed、API、Web/Caddy；最后创建默认家长管理员（若尚不存在）并等待健康检查。
- 管理员默认账号和密码在终端明确打印，重复运行不重置已有账号密码。
- 失败时打印 Compose 状态/日志提示；不自动执行 `down -v`、删卷或覆盖数据库/媒体。

## 访问与边界

- 输出 `http://<LAN IPv4>:8080` 作为主站地址，`http://<LAN IPv4>:9000` 仅供视频上传/播放。
- 明文 HTTP 和固定凭据仅适用于可信家庭局域网；不能用于公网部署。路由器、云安全组或主机防火墙必须允许家庭设备访问 TCP 8080 和 9000；云服务器若无与手机互通的私网，局域网手机无法直接访问。
- PostgreSQL、MinIO Console 与内部 API 不发布宿主端口。保留独立数据卷和现有公网 Compose 不变。

## 验证

- 自动化检查脚本入口、Docker/Compose 缺失时的提示、LAN IPv4 解析与覆盖、首次创建和重复运行配置行为、Compose 服务端口/卷/依赖拓扑。
- 在有 Docker 的环境运行 Compose 配置校验；若本环境可运行 Linux 容器，再进行全栈健康检查，并验证从非服务器客户端来源完成登录、视频分片上传和播放地址访问。
- 保持用户已有未提交修改不变；不清理任何已有卷。
