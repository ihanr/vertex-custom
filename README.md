# VERTEX

<img src="https://raw.githubusercontent.com/vertex-app/vertex/stable/webui/public/assets/images/logo.svg" width="144"/>

#### 适用于 PT 玩家的追剧刷流一体化综合管理工具

#### 交流群组

[VERTEX](https://t.me/group\_vertex)

#### 特别事项

Vertex 目前已处于不新增功能，仅做问题修复的状态。

#### Wiki
[https://wiki.vertex-app.top](https://wiki.vertex-app.top)

#### 打赏，如果你觉得这个项目对你有帮助，可以对我打赏，感谢！

<figure><img src="https://lswl.in/assets/images/alipay_qrcode.png" alt="" width="375"><figcaption></figcaption></figure>

## Docker Compose 安装（全新服务器）

前提：已安装 Git、Docker Engine 和 Docker Compose V2，能访问 GitHub、Docker Hub 和 npm。
这是**拉取源码后本机构建**，不是下载已发布的 `ihanr` 成品镜像。使用仓库根目录的 `Dockerfile`，不要使用旧的 `docker/Dockerfile`（上游 CI 模板）。

```bash
git clone https://github.com/ihanr/vertex-custom.git
cd vertex-custom
VERTEX_REVISION="$(git rev-parse HEAD)" docker compose up -d --build
```

构建会生成本仓库的定制前端并复制定制后端；运行环境、原生依赖和干净初始化模板来自公开的 `lswl/vertex:2026.05.27`。不需要现有 Vertex 容器或私有定制镜像。保留旧运行环境是为了兼容现有依赖，并不代表其所有依赖均已完成安全升级。首次构建需要下载依赖并编译前端，内存不足时可能被系统终止；不要据此反复删除数据重装。

### 访问和首次登录

默认仅监听服务器的 `127.0.0.1:3000`，避免管理界面直接暴露公网。在自己的电脑建立 SSH 隧道，然后浏览器访问 `http://127.0.0.1:3000`：

```bash
ssh -N -L 3000:127.0.0.1:3000 用户名@服务器地址
```

默认用户名为 `admin`。首次启动时生成随机密码，在服务器的仓库目录中查看：

```bash
docker compose exec vertex cat /vertex/data/password
```

不要把密码输出、运行配置或完整数据库贴到 Issue 或提交到 Git；登录后修改密码。若要经服务器 IP 直接访问，先配置防火墙仅允许自己的 IP，再显式修改监听地址：

```bash
VERTEX_BIND_IP=0.0.0.0 docker compose up -d
```

此环境变量只作用于当前命令。长期设置可在仓库目录创建被 Git 忽略的 `.env`，例如：

```dotenv
VERTEX_BIND_IP=127.0.0.1
VERTEX_PORT=3000
VERTEX_DATA_DIR=./vertex
```

可将 `VERTEX_PORT` 改为其他宿主机端口。默认桥接网络下，容器里的 `127.0.0.1` 不代表宿主机；配置 qB 时请填容器可达的下载器地址。

### 数据、状态和更新

- 默认把 `./vertex` 挂载到 `/vertex`，包含数据库、任务、配置和日志；重建容器不会清空它。
- `.dockerignore` 使用允许列表排除 Git 历史、运行数据、私钥和本机依赖，构建不会带入你的生产配置。
- 不要让两个 Vertex 实例同时使用同一数据目录。已用 1Panel 或 `docker run` 安装的旧实例不能直接照搬本节新装命令；应先确认旧挂载目录、停止旧实例、备份并单独迁移。
- 此流程不发布 Docker Hub/GHCR 镜像，也不修改服务器上独立运行的 qB。

```bash
docker compose ps
docker compose logs --tail 50 vertex
docker compose exec vertex tail -50 /vertex/logs/app-error.log
```

健康检查通过表示登录页可访问，不代表每个 RSS、qB 或辅种任务都正常。应用详细日志仍位于数据目录的 `logs/` 中。

更新前先用网页备份，或停止服务后备份**实际数据目录**。以下仅针对默认 `./vertex`，备份文件含敏感配置：

```bash
(
  set -e
  umask 077
  trap 'docker compose start' EXIT
  docker compose stop
  tar -czf "../vertex-backup-$(date +%Y%m%d-%H%M%S).tar.gz" vertex
  docker compose start
  trap - EXIT
  git pull --ff-only
  VERTEX_REVISION="$(git rev-parse HEAD)" docker compose up -d --build
  docker compose ps
)
```

不要删除 `./vertex` 来解决启动失败。仓库的 [Docker 安装测试](https://github.com/ihanr/vertex-custom/actions/workflows/docker-install.yml) 会在独立空目录检查镜像构建、首次登录、原生 SQLite 及重建容器后的数据保留；是否通过以对应提交的 Actions 结果为准。

## 此定制版的改动

本仓库基于 Vertex 源码，增加了 RSS 的下载器分流和自动辅种界面。

### 1. RSS 规则下载器组

在 **规则组件 → RSS 规则** 中，每条规则可以选择多个“下载器组”。当 RSS 种子命中该规则时，Vertex 只会在此组内按 RSS 任务的排序规则选择下载器；不会跑到其他组。

- 规则没有选择下载器组：沿用 RSS 任务原有的下载器列表。
- 规则选择了下载器组但全都不可用：拒绝该种子，不会回退到其他机器。
- RSS 任务中的“下载器”要同时勾选参与分流的全部机器；种子命中哪条规则，就只会在该规则对应的下载器组内选择。
- **不要在 RSS 任务设置“下载器下载任务上限”**：留空或设为 `0`。该值会对本 RSS 任务的所有下载器统一生效，不适合大小分流。
- 应在 **基础组件 → 下载器** 中，按每台机器的硬盘大小分别设置“最大下载数量/任务数”。例如小盘机设较低任务数，大盘机设较高任务数。

### 2. RSS 自动辅种与仅辅种

在 **任务配置 → RSS 任务** 编辑页，“最长休眠时间”下方新增：

- **启用自动辅种**：在“辅种下载器”中查找已经完成的数据。
- **仅辅种**：找不到已有数据时，不再正常下载该种子。
- **辅种下载器**：可多选，用于查找文件来源的 qBittorrent 下载器。

自动辅种的匹配条件是：候选种子与 RSS 种子 **文件名相同、总大小相同、候选种子已完成，且 info hash 不同**。找到后，B 站的新种子会添加到**找到已有文件的同一台下载器**，并复用该种子的保存路径。

辅种成功后会添加两个标签：新添加的辅种种子加 `Reseed`，实际提供文件的原种加 `Brseed`。只有 qB 已登记新种并确认其 `Reseed` 标签生效后，才会给原种添加 `Brseed`；未命中、仅扫描到候选数据、新种未登记或 `Reseed` 失败时都不会添加。`Brseed` 失败不会撤销已确认的 `Reseed`，最终未确认会在记录中标为“辅种（标签失败）”，不会静默当作成功。

> 警告：自动辅种会使用“跳过校验”添加。文件名和大小相同并不绝对等于文件内容相同；只应对确定为同一资源的跨站种子启用。

## 配置示例

### 示例一：按种子大小分流

目标：

| 种子大小 | RSS 规则 | 下载器组 |
| --- | --- | --- |
| 500 MiB–20 GiB | `种子500m-20g` | `小盘鸡-01`、`小盘鸡-02`、`小盘鸡-03` |
| 20 GiB–280 GiB | `种子20g-280g` | `大盘鸡-01`、`大盘鸡-02`、`大盘鸡-03` |

操作：

1. 在 **规则组件 → RSS 规则** 找到或新建 `种子500m-20g`，在“下载器组”勾选小盘鸡组。
2. 编辑 `种子20g-280g`，在“下载器组”勾选大盘鸡组。
3. 在 RSS 任务底部的“选择规则”同时勾选这两条 RSS 规则；在 RSS 任务上方“下载器”也同时勾选小盘鸡和大盘鸡两组机器。
4. 种子命中 `种子500m-20g` 时，只会在小盘鸡组内选择；命中 `种子20g-280g` 时，只会在大盘鸡组内选择。
5. RSS 任务的“下载器下载任务上限”留空或设为 `0`；进入 **基础组件 → 下载器**，按硬盘大小为每台小盘鸡/大盘鸡分别设置最大下载任务数。
6. RSS 地址请自行填入站点提供的地址，例如 `https://tracker.example/torrentrss.php?passkey=<你的_PASSKEY>`；不要将真实地址提交到 Git。

大小边界按规则名称理解为包含端点：500 MiB、20 GiB、280 GiB。20 GiB 同时落入两条规则时，应让其中一条规则的条件排除另一条边界，避免同一 RSS 项同时命中两条规则。

### 示例二：A 站下载，B 站仅辅种（机器磁盘独立）

前提：A 站 RSS 已将文件下载到下列独立磁盘下载器：

```text
大盘鸡-01、大盘鸡-02、大盘鸡-03
```

编辑 B 站 RSS 任务：

1. 在“下载器”勾选上述下载器。这一栏用于 RSS 任务可用性判定。
2. 勾选“启用自动辅种”。
3. 勾选“仅辅种”，防止 B 站找不到文件时触发正常下载。
4. 在“辅种下载器”勾选上述相同下载器，用于逐台寻找已完成数据。
5. “下载器”和“辅种下载器”必须选择**同一组机器**。

辅种逻辑：B 站 RSS 出现种子后，会在“辅种下载器”中逐台查找 **已完成、文件名相同、总大小相同且 info hash 不同** 的种子。命中后，B 站种子会添加到找到数据的**同一台机器**，复用该种子的保存路径、跳过校验，并先确认 `Reseed` 标签；确认成功后，提供数据的原种才会加上 `Brseed` 标签。由于已勾选“仅辅种”，没有命中已有数据、或新种未成功确认时都不会触发普通下载，也不会给任何原种添加 `Brseed`。

这些机器即使不能互相访问，也可以使用：程序会把 B 站种子添加到**实际找到文件的那台机器**，不会把 `大盘鸡-01` 上的路径交给 `大盘鸡-02` 使用。

## 使用与安全边界

- 此仓库的 `.gitignore` 会忽略 `app/config/`、`vertex/`、数据库、`.env`、部署包及常见私钥文件。
- 生产运行数据应保留在 Docker 挂载目录中，例如 `/opt/1panel/apps/vertex`；不要复制进本仓库。
- 升级前先备份运行数据和当前容器检查信息。新镜像启动后，等待约 20 秒再验证 `http://127.0.0.1:3000/`。
- 公开 Issue、日志和截图中同样不要暴露 Tracker 域名、Passkey、Cookie、WebUI 密码或服务器 IP。

## 验证

### 本地加固改动的运行边界

- 备份上传只在登录后解析，默认总文件大小上限为 512 MiB，可通过 `VERTEX_BACKUP_UPLOAD_MAX_BYTES` 调整。恢复包最多 100000 个条目、解压文件总大小最多 8 GiB；拒绝链接、越界路径及缺少必要配置或数据库的备份。
- 网页备份使用 SQLite 在线备份接口，包含已提交的 WAL 数据；配置文件与数据库并非跨文件事务快照，严格一致的全量备份仍建议停服务后执行。备份文件包含敏感配置，请妥善保存。
- 上传恢复包只进行校验和暂存，下次容器启动才切换。旧目录保留在数据卷的 `.restore-previous-*` 下；切换中断会尝试回滚，失败则停止启动，不清空整个数据卷。旧备份占用磁盘，不会自动删除。
- 普通下载添加前预占下载器任务名额；辅种不占普通下载名额。HTTP 请求被接受后，历史记录或通知失败不再作为重新添加的理由。
- 新发生的添加失败保存在数据库恢复队列。明确失败至少等待 120 秒，最多尝试 5 次；请求结果不确定时先查询原下载器，不改投其他机器。重发仍需该种子出现在 RSS 中并通过当前规则和限制。没有恢复队列的旧失败历史不会自动批量重发。
- 辅种添加后，只有新种 `Reseed` 确认成功，才给对应原种添加 `Brseed`。标签失败会保存原种和下载器信息；每分钟最多处理 5 个到期恢复任务，补标按退避时间重试，最多 24 轮（每轮包含接口重试）。目标种子已不存在时停止补标，不重新下载它。
- 停用 RSS 会停止该任务的定时恢复；已经发出的 HTTP 请求不能撤回。以上机制不保证离线下载器或长期失败的标签接口最终成功，需要查看错误日志处理。
- 补 `Brseed` 前实时查询原种：确认原种已不存在时，保留已确认的 `Reseed`，历史注明“原种已不存在，停止补 Brseed”，随后移出待处理队列；查询失败仍按原有退避及次数上限重试，不当作原种消失。已处于 `stopped` 的旧任务不会自动重新激活。

本定制版包含以下最小测试：

```bash
npm test
node --check app/common/Rss.js
```

前端构建需先生成主题文件：

```bash
cd webui
node dark
node light
node cyber
./node_modules/.bin/vue-cli-service build
```

Windows PowerShell 可将最后一行改为：

```powershell
.\node_modules\.bin\vue-cli-service.cmd build
```
