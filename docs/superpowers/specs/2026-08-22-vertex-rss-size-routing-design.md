# Vertex RSS Size-Based Downloader Groups

## Goal

Allow one RSS task to route a matched torrent into a rule-specific group of downloaders, then select one downloader from that group using the RSS task's existing availability filters and sort rule.

## User-facing behavior

An RSS rule gains an optional multi-select field named `clientArr` (downloader group). Existing optional `client` remains supported for legacy single-downloader rules.

For the requested policy:

- `500 MiB <= size <= 20 GiB` routes only among `advin`, `HZ-01`, `HZ-02`, `HZ-03`, `HZ-04`, and `HZ-05`.
- `20 GiB < size <= 280 GiB` routes only among `KS1B-DE-1`, `KS1B-DE-2`, `KS1B-DE-3`, `KS2-CA-1`, `KS2-CA-2`, `KS2-CA-3`, `KS2-UK-1`, `KS2-UK-2`, and `KS2-UK-3`.
- Torrents outside those intervals do not match either acceptance rule and are rejected when those are the only acceptance rules on the task.

The boundary at exactly 20 GiB belongs to the smaller group.

## Routing algorithm

1. Evaluate reject rules first, as today.
2. Evaluate acceptance rules in descending priority. If no rule matches while acceptance rules are configured, reject the torrent.
3. Take the highest-priority matched rule.
4. Candidate source, in order:
   - `rule.clientArr` when it is non-empty;
   - legacy `rule.client` when it is set;
   - `rssTask.clientArr` otherwise.
5. Filter candidate clients with the same online, maindata, RSS task speed/count, client speed/count, and free-space checks currently used for RSS routing.
6. Sort remaining candidates with the RSS task's existing `clientSortBy`, then choose the first.
7. If no candidate remains, record and notify `无可用下载器`; do not attempt an add request.
8. Add the torrent using the matched rule's category/save-path overrides and the selected client.

Legacy single-client rules continue to route to their configured client. Existing RSS tasks and rules without `clientArr` retain current behavior.

## UI and data compatibility

- In RSS-rule editing, replace the current single downloader selector with a multi-select downloader group. Persist selected downloader IDs in `clientArr`.
- Preserve the legacy `client` field in stored JSON and backend behavior. Existing rules render their former single client as the initial one-item group until saved.
- The RSS task's downloader list remains the default group only; a rule-specific group can contain enabled clients even if they are not in the task's default list.

## Tests

Unit tests cover:

- small-rule and large-rule boundary routing;
- sorting within the selected rule group;
- offline/full group rejection;
- no-rule-group fallback to the task downloader group;
- legacy single-client routing;
- non-overlap at exactly 20 GiB.

## Deployment

The deployed container uses `lswl/vertex:2026.05.27` with `/opt/1panel/apps/vertex` mounted at `/vertex`; source code is inside the image. Deployment therefore builds a versioned custom image, switches only the 1Panel/Compose image reference, preserves the existing `/vertex` bind mount, verifies the UI and routing behavior, and retains the original image tag for rollback.
