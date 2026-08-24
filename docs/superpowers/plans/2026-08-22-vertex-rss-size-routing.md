# Vertex RSS Size Routing Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend one Vertex RSS task so its matched RSS rules can each select a downloader group. The group uses the RSS task's existing availability checks and sorting, allowing 500 MiB–20 GiB torrents and 20 GiB–280 GiB torrents to be routed separately without polling the feed twice.

**Architecture:** Keep the existing single `client` rule field compatible, and add an optional rule-level `clientArr`. During an RSS run, first determine the highest-priority matched accept rule, derive that rule's downloader candidates (`clientArr`, then legacy `client`, then the RSS task group), apply the existing candidate health/capacity checks and task sort, then push using that selected client. The RSS rule editor gains a multi-select group field; saved older rules remain valid.

**Tech Stack:** Node.js/CommonJS backend, Vue 3 + Ant Design Vue, existing Vertex SQLite/config persistence, Docker image based on `lswl/vertex-base`.

**Spec:** `docs/superpowers/specs/2026-08-22-vertex-rss-size-routing-design.md`

## Guardrails

- Do not create a second RSS task or make a second feed request; selection happens after a single task has fetched and de-duplicated feed entries.
- Existing rules containing only `client` must keep their current meaning.
- An empty rule `clientArr` means "fall back"; it must not create an empty candidate set.
- If a matching rule's intended group has no eligible downloader, record and notify `拒绝原因: 无可用下载器`; do not fall back into another size group.
- Preserve rule priority: only the first matching accept rule is allowed to determine routing, category, and save path.
- Keep all runtime data in the existing `/vertex` bind mount; deployment replaces only the image/container.

## File map

- Modify: `app/common/Rss.js` — centralize downloader candidate selection and choose it from the matched rule.
- Modify: `webui/src/pages/rule/Rss.vue` — add a rule-level downloader-group multi-select and migrate legacy form values on edit/clone.
- Add: `tools/rss-size-routing.test.js` — Node test fixture for candidate precedence, capacity rejection, and task-group fallback.
- Modify: `package.json` — include the new test in the existing `npm test` entry point.
- Add/modify only if required after build inspection: a documented custom-image build command using `docker/Dockerfile` with the checked-out source copied into the build context; do not alter server-side persistent paths.

## Task 1: Write failing backend selection tests

**Files:**
- Create: `tools/rss-size-routing.test.js`
- Modify: `package.json`

1. Build lightweight fake clients with `status`, `maindata`, averages, capacity limits, and distinct IDs.
2. Instantiate the selection logic without triggering a cron job; mock only the minimum globals required by `Rss`.
3. Add assertions for this precedence order:
   - non-empty `fitRule.clientArr` wins over `fitRule.client` and task `clientArr`;
   - legacy `fitRule.client` becomes a one-client candidate group;
   - no rule override uses the task's `clientArr`;
   - an empty rule group falls through to the next compatible source.
4. Add assertions that disabled, missing, task-cap-limited, client-cap-limited, and minimum-free-space-limited candidates are excluded.
5. Add sort assertions for `freeSpaceOnDisk` (descending) and the other existing metrics (ascending), preserving the current ordering semantics.
6. Change `package.json` test script to run the existing limiter test followed by this new test.
7. Run `node tools/rss-size-routing.test.js` and confirm it fails because the selection helper does not exist yet.

## Task 2: Implement safe rule-aware downloader selection

**Files:**
- Modify: `app/common/Rss.js`
- Modify: `tools/rss-size-routing.test.js` as needed for the real method boundary

1. Add a small method on `Rss` that receives candidate downloader IDs and returns the best eligible downloader.
2. Reuse the current RSS-task checks exactly: downloader exists, is enabled, has main data, obeys the RSS task upload/download/leech limits, obeys its own upload/download/leech/free-space limits, then applies `clientSortBy`.
3. Add a small resolver that takes the matched accept rule and chooses candidates in this order:
   - `fitRule.clientArr` when it is an array with at least one value;
   - `[fitRule.client]` for a legacy single-client rule;
   - the RSS task's `this.clientArr`.
4. In `rss()`, preserve de-duplication, frozen-marker handling, hourly limit, max-sleep protection, and reject-rule processing. After reject rules, compute the matched accept rules once and use the first match for both routing and push options.
5. Select the downloader through the resolver. If none is eligible, keep the current rejection record/notification text and continue without calling `_pushTorrent`.
6. Pass the already matched rule into `_pushTorrent` (or an equivalent explicit argument) so it does not evaluate JavaScript rules twice. Use that exact rule for category/save path; remove the old late direct override that would bypass the selected group.
7. Leave reseed behavior unchanged; it is independent of normal download routing.
8. Run `node --check app/common/Rss.js` and `node tools/rss-size-routing.test.js`. Then run `npm.cmd test`.

## Task 3: Add the RSS-rule group UI with compatibility behavior

**Files:**
- Modify: `webui/src/pages/rule/Rss.vue`

1. Keep the existing single-client field visible as the compatibility/default field, labelled clearly as the legacy single downloader.
2. Add a second `a-select` with `mode="multiple"`, bound to `rssRule.clientArr`, labelled `下载器组`, with help text that it overrides the legacy single downloader and the RSS task downloader list only when non-empty.
3. When opening or cloning a legacy rule that has `client` but no `clientArr`, initialize the edit form's `clientArr` to an empty array (not `[client]`), so simply opening/saving does not turn legacy behavior into a different stored shape.
4. Normalize an empty UI selection before saving so it is omitted/empty and the backend fallback remains active.
5. Update the list's downloader display to show `clientArr` aliases when present, otherwise the legacy client, while leaving the inline quick single-client selector behavior unchanged or explicitly scoped to legacy client only.
6. Build the frontend with `npm.cmd run build` from `webui` after installing its dependencies; resolve syntax/lint/build errors caused by this change only.

## Task 4: Verify end-to-end behavior locally

**Files:**
- Review: `app/common/Rss.js`, `webui/src/pages/rule/Rss.vue`, `package.json`

1. Run `npm.cmd test` from the repository root.
2. Run `npm.cmd run eslint` from the repository root, documenting any pre-existing configuration/dependency failure separately from new errors.
3. Run `npm.cmd run build` from `webui`.
4. Inspect `git diff --check` and `git diff -- app/common/Rss.js webui/src/pages/rule/Rss.vue package.json tools/rss-size-routing.test.js`.
5. Confirm the two user rules can be entered as:
   - `500 MiB < size < 20 GiB` using the normal rule's strict comparisons, with `advin`, `HZ-01`–`HZ-05` selected in its downloader group;
   - `20 GiB < size < 280 GiB` with `KS1B-DE-1`–`-3`, `KS2-CA-1`–`-3`, and `KS2-UK-1`–`-3` selected.
   Explain the strict-boundary consequence and offer a tiny JavaScript rule only if the user requires exact inclusion at 500 MiB/20 GiB/280 GiB.

## Task 5: Build and deploy a reversible custom image

**Files:**
- Review: `docker/Dockerfile`
- No persistent Vertex-data file changes

1. Compare the local source base with the remote `vertex` container's code path and image labels before building, to avoid deploying a source/image mismatch.
2. Create a versioned image tag such as `vertex-size-routing:2026-08-22` from the checked-out, tested source. Pin the source commit used by the Docker build; do not use an unpinned `latest` source checkout.
3. On the server, back up only `/opt/1panel/apps/vertex` to a timestamped tarball before recreating the container. Verify the tarball is non-empty.
4. Recreate `vertex` with the same published ports, restart policy, network, environment, and `/opt/1panel/apps/vertex:/vertex` mount, replacing only `lswl/vertex:2026.05.27` with the custom tag. Inspect the current container first; do not guess 1Panel's compose path or options.
5. Verify with `docker ps`, `docker logs --tail 100 vertex`, HTTP health/UI access, and the rule editor showing `下载器组`.
6. Keep `lswl/vertex:2026.05.27` present for rollback. If startup or UI verification fails, recreate the original container using the inspected configuration and the original image; persistent data remains in the bind mount.

## Handoff checks

- One RSS task still fetches its feed once per scheduled run.
- 500 MiB–20 GiB candidates never route to the KS group, and 20 GiB–280 GiB candidates never route to advin/HZ, even if the other group is idle.
- Each group uses the task's selected sort metric among only its own eligible downloaders.
- Old RSS rules with only `client` still add to that one downloader.
- The tested source commit and deployed custom image tag are recorded for future upgrade/rollback.
