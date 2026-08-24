# Vertex 3ratio Limiter Design

## Goal

Provide a Vertex scheduled JavaScript task that limits upload speed for eligible qBittorrent torrents without storing downloader credentials in the task.

## Scope

- Downloaders: `HZ-01`, `HZ-02`, `HZ-03`, `HZ-04`, `HZ-05`, `KS1B-DE-1`, `KS1B-DE-2`, `KS2-CA-1`, `KS2-CA-2`, `KS2-FR-1`, `KS2-FR-2`, `KS2-UK-1`, and `KS2-UK-2`.
- Categories: exact matches only: `MTV`, `HH`, and `TTG`.
- Eligible torrent: qBittorrent torrent with a completed/seeding state, no `3ratio` tag, and `uploaded / totalSize >= 3.3`.
- Action: set that torrent's upload limit to `10240` bytes/s (10 KiB/s), then apply the `3ratio` tag.

## Execution

- Schedule the task with the five-field cron expression `* * * * *` (once per minute).
- Obtain downloader connections from Vertex's in-memory `global.runningClient`; do not embed URLs, usernames, passwords, cookies, or API keys.
- Start with `DRY_RUN = true`. In this mode the task logs each matching torrent and makes no qBittorrent changes.
- After the user confirms the logs, change only `DRY_RUN` to `false` to enable limits and tagging.

## Safety and Failure Handling

- Skip offline clients, clients without current `maindata`, and non-qBittorrent clients.
- Ignore each failure independently, log the downloader alias and torrent hash/name, and continue scanning the remaining clients.
- The `3ratio` tag makes the operation idempotent. The task must only tag after the limit call succeeds.
- The task does not remove tags, restore limits, delete torrents, pause torrents, or operate on categories other than `MTV`, `HH`, and `TTG`.

## Verification

1. Save the task with `DRY_RUN = true` and run it once manually.
2. Verify every logged item belongs to one of the three named categories and has a ratio of at least 3.3.
3. Change `DRY_RUN` to `false`, run once, and inspect one known target in qBittorrent: its per-torrent upload limit must be 10 KiB/s and its tags must include `3ratio`.
4. Run it again and confirm that same torrent is skipped because it is already tagged.
