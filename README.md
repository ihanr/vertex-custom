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

## 此定制版的改动

本仓库基于 Vertex 源码，增加了 RSS 的下载器分流和自动辅种界面。它不包含任何使用者的运行配置、Cookie、RSS 地址、Passkey、下载器账号、数据库或服务器文件。

### 1. RSS 规则下载器组

在 **规则组件 → RSS 规则** 中，每条规则可以选择多个“下载器组”。当 RSS 种子命中该规则时，Vertex 只会在此组内按 RSS 任务的排序规则选择下载器；不会跑到其他组。

- 规则没有选择下载器组：沿用 RSS 任务原有的下载器列表。
- 规则选择了下载器组但全都不可用：拒绝该种子，不会回退到其他机器。
- “下载任务上限”仍是每台下载器自己的全局限制，不是某个大小规则独有的限制。

### 2. RSS 自动辅种与仅辅种

在 **任务配置 → RSS 任务** 编辑页，“最长休眠时间”下方新增：

- **启用自动辅种**：在“辅种下载器”中查找已经完成的数据。
- **仅辅种**：找不到已有数据时，不再正常下载该种子。
- **辅种下载器**：可多选，用于查找文件来源的 qBittorrent 下载器。

自动辅种的匹配条件是：候选种子与 RSS 种子 **文件名相同、总大小相同、候选种子已完成，且 info hash 不同**。找到后，B 站的新种子会添加到**找到已有文件的同一台下载器**，并复用该种子的保存路径。

> 警告：自动辅种会使用“跳过校验”添加。文件名和大小相同并不绝对等于文件内容相同；只应对确定为同一资源的跨站种子启用。

## 配置示例

以下名称仅是下载器别名示例，不包含 qB 地址、用户名、密码、Cookie、Passkey、真实 RSS 地址、IP 或实际路径。

### 示例一：按种子大小分流

目标：

| 种子大小 | RSS 规则 | 下载器组 |
| --- | --- | --- |
| 500 MiB–20 GiB | `种子500m-20g` | `advin`、`HZ-01`、`HZ-02`、`HZ-03`、`HZ-04`、`HZ-05` |
| 20 GiB–280 GiB | `种子20g-280g` | `KS1B-DE-1`、`KS1B-DE-2`、`KS1B-DE-3`、`KS2-CA-1`、`KS2-CA-2`、`KS2-CA-3`、`KS2-UK-1`、`KS2-UK-2`、`KS2-UK-3` |

操作：

1. 在 **规则组件 → RSS 规则** 找到或新建 `种子500m-20g`，在“下载器组”勾选 HZ/advin 组。
2. 编辑 `种子20g-280g`，在“下载器组”勾选 KS 组。
3. 在 RSS 任务底部的“选择规则”同时勾选这两条 RSS 规则。
4. RSS 任务上方“下载器”至少保留一个在线下载器，满足任务可用性判定；命中下载器组的种子仍只会在对应组内选择。
5. RSS 地址请自行填入站点提供的地址，例如 `https://tracker.example/torrentrss.php?passkey=<你的_PASSKEY>`；不要将真实地址提交到 Git。

大小边界按规则名称理解为包含端点：500 MiB、20 GiB、280 GiB。20 GiB 同时落入两条规则时，应让其中一条规则的条件排除另一条边界，避免同一 RSS 项同时命中两条规则。

### 示例二：A 站下载，B 站仅辅种（机器磁盘独立）

前提：A 站 RSS 已将文件下载到下列独立磁盘下载器：

```text
KS1B-DE-1、KS1B-DE-2、KS1B-DE-3
KS2-CA-1、KS2-CA-2、KS2-CA-3
KS2-UK-1、KS2-UK-2、KS2-UK-3
```

编辑 B 站 RSS 任务：

1. 在“下载器”勾选上述下载器。这一栏用于 RSS 任务可用性判定。
2. 勾选“启用自动辅种”。
3. 勾选“仅辅种”，防止 B 站找不到文件时触发正常下载。
4. 在“辅种下载器”勾选上述相同下载器，用于逐台寻找已完成数据。
5. 应用后先使用“试运行”或观察任务历史，确认匹配到的资源符合预期。

这些机器即使不能互相访问，也可以使用：程序会把 B 站种子添加到**实际找到文件的那台机器**，不会把 `KS2-CA-1` 上的路径交给 `KS1B-DE-1` 使用。

## 使用与安全边界

- 此仓库的 `.gitignore` 会忽略 `app/config/`、`vertex/`、数据库、`.env`、部署包及常见私钥文件。
- 生产运行数据应保留在 Docker 挂载目录中，例如 `/opt/1panel/apps/vertex`；不要复制进本仓库。
- 升级前先备份运行数据和当前容器检查信息。新镜像启动后，等待约 20 秒再验证 `http://127.0.0.1:3000/`。
- 公开 Issue、日志和截图中同样不要暴露 Tracker 域名、Passkey、Cookie、WebUI 密码或服务器 IP。

## 验证

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
