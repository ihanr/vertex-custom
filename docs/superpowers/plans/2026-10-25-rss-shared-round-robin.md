# RSS Shared Round-Robin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为普通 RSS 进种增加进程内跨任务共享轮询，同时保持原排序与辅种行为。

**Architecture:** 配置使用 `allocationMode: original | roundRobin`，默认 original。普通分配使用共享的下载器分配顺序及准备阶段占位；发请求时衔接现有客户端在途记录，重试继续固定原机。共享状态仅在普通下载使用，不修改公共客户端加种接口。

**Tech Stack:** 现有 Node.js/CommonJS、Vue 3、node:assert；不增加依赖。

**Spec:** ../specs/2026-10-25-rss-shared-round-robin-design.md

## Global Constraints

- 当前目录直接实现，不创建分支、不提交、不推送、不部署；不读取或改动 `local-docker/`。
- 缺失/未知配置默认 original；不改变原排序、规则组或任何辅种语义。
- 不修改 Client.js 公共加种接口，不改变 SKY 标签、限速、分类或删种逻辑。
- 只在同一 VT 进程共享；重启后重新开始；不新增冷却、等待队列或跨组回退。

## Review Focus

- 多个 RSS 在第一次异步加种返回之前共同选机，必须同步占位并分散。
- 交叉规则组和仅一台合格候选不能被全局顺序越权扩组。
- 辅种成功、仅辅种无匹配及辅种恢复不得消耗普通轮询名额。
- 停用任务、准备失败与明确拒绝必须释放准备占位；结果不明不得换机重发。
- 在途记录和准备占位不能重复计数，旧模式不可被新状态改变。

---

### Task 1: 普通分配与辅种隔离

**Files:**
- Modify: `app/common/Rss.js`
- Test: `tools/rss-behavior.test.js`
- Test: `tools/hardening.test.js`

**Interfaces:**
- Consumes: `_getClientIds(fitRule)`、`_getReseedClientIds(fitRule)`、`client.getLeechingCount()`、既有 rss-actions journal。
- Produces: `allocationMode` 默认兼容、普通下载专用共享选机和占位生命周期；辅种与原机重试不进入新选机。

- [x] 补真实 Rss 调用的失败测试：两任务交错进种选择 A/B，下一轮选择 C；规则组只允许 B/C 时不选 A。
- [x] 补隔离测试：辅种成功后第一颗普通种仍选 A；仅辅种无匹配仍无普通加种；普通组不可用时辅种照常。
- [x] 补边界测试：过滤离线、速度、数量、空间；并发准备占位；URL/文件加种；失败释放与超时原机恢复。
- [x] 运行新增测试，确认因缺少共享分配而失败，记录失败证据。
- [x] 实现配置默认和普通下载专用状态，保留原模式及辅种路径；优先复用现有过滤与 journal。
- [x] 重跑相关测试，确保全部通过；确认没有 Client.js 公共接口改动。

### Task 2: 配置入口与完整验证

**Files:**
- Modify: `webui/src/pages/task/Rss.vue`
- Modify: `app/model/RssMod.js`（配置默认兼容，必要时）
- Modify: `README.md`
- Test: 现有前端组件编译与配置行为测试，按实际需要追加到现有测试文件。

**Interfaces:**
- Consumes: Task 1 的 `allocationMode`。
- Produces: “分配方式”中的“原排序 / 共享轮询”，新旧任务正确显示默认；仅原排序启用原排序控件。

- [x] 补配置往返/缺失值兼容测试，先确认失败，再增加表单字段与默认值。
- [x] 更新简明使用说明：范围、候选过滤、单候选与重启边界、辅种不受影响。
- [x] 运行 `npm.cmd test` 和 `npm.cmd run eslint`。
- [x] 在 webui 运行 `npm.cmd run eslint` 和 `npm.cmd run build`；报告实际警告或失败。
- [x] 自查 diff 与设计逐项对照，检查状态、标签、辅种和重试边界；仅交付本地改动与验证，不提交。

## 验证记录（2026-10-25）

- 初次后端测试观察到 6 个轮询失败用例、2 个占位/恢复失败用例，配置与页面默认测试也先失败再通过。
- 独立只读审查发现两个重要边界：普通重试绕过占位、停用后辅种异步失败仍能新建占位。新增 3 个回归用例先失败，修复后最终 `npm.cmd test`：223 项 PASS，退出码 0。
- `Client.js` 无改动。辅种与 SKY 既有回归通过；未连接实际 qB 或服务器验证。
- 前端构建退出码 0，保留既有 Browserslist、包体积/PWA 相关警告。
- 默认后端 lint 扫入已有 `app/static` 编译产物失败；排除该目录的完整后端源码 lint 通过。
- 默认前端 lint 在未修改文件中报 Windows CRLF；仅关闭 `linebreak-style` 的完整前端源码 lint 通过。未批量改换行、未修改 lint 配置。
- 共享状态保存在 Client 对象关联内存中；重建下载器实例或重启 VT 后顺序重置。原排序既有准备阶段行为不在本次修改范围。
