# Vertex 3ratio Limiter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a copy-pasteable Vertex scheduled JavaScript task that limits eligible qBittorrent torrents to 10 KiB/s after a 3.3 ratio.

**Architecture:** A single async function evaluates Vertex's approved in-memory clients, filters cached qB torrents, then calls Vertex's per-torrent limit and tag methods. A dry-run flag makes the first deployment read-only.

**Tech Stack:** Vertex stable, Node.js, qBittorrent Web API through `Client.setSpeedLimit()` and `Client.addTorrentTag()`.

## Global Constraints

- Client aliases are exactly `HZ-01`, `HZ-02`, `HZ-03`, `HZ-04`, `HZ-05`, `KS1B-DE-1`, `KS1B-DE-2`, `KS2-CA-1`, `KS2-CA-2`, `KS2-FR-1`, `KS2-FR-2`, `KS2-UK-1`, and `KS2-UK-2`.
- Allowed categories are exact matches only: `MTV`, `HH`, and `TTG`.
- Eligibility is a completed seeding qB torrent with `uploaded / totalSize >= 3.3` and no `3ratio` tag.
- Apply a 10 KiB/s upload cap (`10240` bytes/s), then add the `3ratio` tag.
- Initial delivery uses `DRY_RUN = true`; it must not mutate qBittorrent.
- The Vertex schedule is `* * * * *`.

---

### Task 1: Implement and test the limiter module

**Files:**
- Create: `tools/vertex-3ratio-limiter.js`
- Create: `tools/vertex-3ratio-limiter.test.js`

**Interfaces:**
- Consumes: `global.runningClient`, `alias`, `_client.type`, `status`, `maindata.torrents`, `setSpeedLimit(hash, 'upload', 10240)`, and `addTorrentTag(hash, '3ratio')`.
- Produces: an async task function and a standalone Vertex function expression.

- [ ] **Step 1: Write the failing test**

```js
const assert = require('node:assert/strict');
const task = require('./vertex-3ratio-limiter');
const calls = [];
global.logger = { info: () => {}, error: () => {} };
global.runningClient = {
  a: {
    alias: 'HZ-01', _client: { type: 'qBittorrent' }, status: true,
    maindata: { torrents: [
      { hash: 'ok', category: 'MTV', progress: 1, state: 'uploading', uploaded: 330, totalSize: 100, tags: '' },
      { hash: 'tagged', category: 'HH', progress: 1, state: 'uploading', uploaded: 400, totalSize: 100, tags: '3ratio' },
      { hash: 'excluded', category: 'OTHER', progress: 1, state: 'uploading', uploaded: 400, totalSize: 100, tags: '' }
    ] },
    setSpeedLimit: async (...args) => calls.push(['limit', ...args]),
    addTorrentTag: async (...args) => calls.push(['tag', ...args])
  }
};
(async () => {
  await task({ dryRun: false });
  assert.deepEqual(calls, [['limit', 'ok', 'upload', 10240], ['tag', 'ok', '3ratio']]);
})();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/vertex-3ratio-limiter.test.js`

Expected: failure because the limiter module does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create an async task module. Use named constants for the fixed aliases, categories, ratio threshold, speed, tag, and dry-run default. Skip an unavailable or non-qB client; skip torrents outside the categories, without complete/seeding state, with zero total size, below the ratio threshold, or containing the done tag. For every match, log only in dry-run mode. In live mode call `setSpeedLimit` before `addTorrentTag`; catch errors per torrent and continue.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tools/vertex-3ratio-limiter.test.js`

Expected: exit code 0 and the exact call order is limit then tag.

- [ ] **Step 5: Commit**

```bash
git add tools/vertex-3ratio-limiter.js tools/vertex-3ratio-limiter.test.js
git commit -m "feat: add Vertex 3ratio limiter task"
```

### Task 2: Package the standalone scheduled-script wrapper

**Files:**
- Modify: `tools/vertex-3ratio-limiter.js`
- Modify: `tools/vertex-3ratio-limiter.test.js`

**Interfaces:**
- Consumes: the Task 1 async task.
- Produces: a standalone function expression with `DRY_RUN = true` for Vertex's Code field.

- [ ] **Step 1: Add the wrapper assertion**

```js
const source = require('node:fs').readFileSync('tools/vertex-3ratio-limiter.js', 'utf8');
assert.match(source, /DRY_RUN\s*=\s*true/);
assert.match(source, /MTV/);
assert.match(source, /HH/);
assert.match(source, /TTG/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/vertex-3ratio-limiter.test.js`

Expected: failure until the copy-paste wrapper is present.

- [ ] **Step 3: Add activation instructions**

Set the Vertex alias to `3ratio 限速（演练）`, enable it, set cron to `* * * * *`, and paste the wrapper. Run it once and inspect logs. Only after validation change `const DRY_RUN = true` to `false`.

- [ ] **Step 4: Run the full test suite**

Run: `node tools/vertex-3ratio-limiter.test.js`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add tools/vertex-3ratio-limiter.js tools/vertex-3ratio-limiter.test.js
git commit -m "docs: add Vertex limiter activation steps"
```

