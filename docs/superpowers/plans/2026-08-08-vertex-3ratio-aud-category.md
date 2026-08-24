# Vertex 3ratio AUD Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the existing Vertex 3ratio limiter process fully completed AUD-category torrents under the existing limiter rules.

**Architecture:** Keep the current limiter and standalone Vertex script behavior unchanged except for the category allowlist. Add an AUD fixture to the module test so it proves that the category reaches the existing limit-then-tag flow.

**Tech Stack:** Node.js built-in assert, Vertex scheduled-script JavaScript.

## Global Constraints

- Allowed categories must be exactly `MTV`, `HH`, `TTG`, and `AUD`.
- Keep the existing threshold (`3.3`), upload cap (`10240` bytes/s), tag (`3ratio`), client aliases, and status-code validation unchanged.
- Keep standalone copy-paste code behavior synchronized with the tested module.

---

### Task 1: Add and verify AUD eligibility

**Files:**
- Modify: `tools/vertex-3ratio-limiter.test.js`
- Modify: `tools/vertex-3ratio-limiter.js`
- Modify: `tools/vertex-3ratio-limiter.vertex.js`

**Interfaces:**
- Consumes: `limiter({ dryRun: false })` and mock qB client methods.
- Produces: AUD torrents invoke `setSpeedLimit(..., 'upload', 10240)` then `addTorrentTag(..., '3ratio')`.

- [ ] **Step 1: Write the failing test**

Add an eligible `AUD` torrent fixture to the selected HZ-01 client and assert a limit and tag call for its hash.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test`
Expected: FAIL because `AUD` is not in `TARGET_CATEGORIES`.

- [ ] **Step 3: Write minimal implementation**

Change both allowlists to:

```js
const TARGET_CATEGORIES = new Set(['MTV', 'HH', 'TTG', 'AUD']);
```

- [ ] **Step 4: Run verification**

Run: `npm.cmd test` and `npm.cmd run eslint`
Expected: both commands pass.

- [ ] **Step 5: Commit**

```powershell
git add tools/vertex-3ratio-limiter.js tools/vertex-3ratio-limiter.vertex.js tools/vertex-3ratio-limiter.test.js docs/superpowers/plans/2026-08-08-vertex-3ratio-aud-category.md
git commit -m "feat: include AUD in 3ratio limiter"
```
