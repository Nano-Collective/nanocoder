---
"@nanocollective/nanocoder": patch
---

Fixed `file.changed` skill subscriptions silently never firing on Windows. Chokidar reports changed files using the platform separator, so a documented pattern like `docs/**` was asked to match `docs\guide.md` and never could — the daemon started, reported healthy, logged nothing, and did nothing. The same mismatch let a root-scoped pattern such as `*.md` match the nested `sub\a.md`, dispatching an unattended agent run against a file that was deliberately scoped out. Paths are now normalized to `/` at the watcher boundary, so the router, activity reports, and the payload handed to a triggered agent all read one path shape. Closes #964.
