---
"@nanocollective/nanocoder": patch
---

Fixed the daemon socket path on Unix when a deeply nested project pushes it past the `sockaddr_un.sun_path` limit (104 bytes on macOS, 108 on Linux). libuv silently truncates overlong paths rather than failing, so the daemon reported a socket it never bound, its stale-socket cleanup missed the real file, and two projects sharing a truncation prefix could collide on a single socket. Nanocoder now falls back to a stable hashed socket name under the system temp directory (or `/tmp` if `TMPDIR` is itself too long), and `daemon start` reports the path the daemon actually bound instead of recomputing it.
